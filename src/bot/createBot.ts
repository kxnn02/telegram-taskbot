import { Bot } from "grammy";
import { normalizeUsername } from "../domain/roster.js";
import { SystemClock } from "../domain/clock.js";
import { TaskService } from "../service/taskService.js";
import type { TaskStorePort } from "../storage/taskStorePort.js";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { RosterStorePort } from "../storage/rosterStorePort.js";
import { comingFriday, parseDueDate } from "../date/parseDueDate.js";
import { parseAddTaskArgs, ADDTASK_USAGE } from "./addTaskParse.js";
import { parseMentionTrigger } from "./mentionParse.js";
import { resolveCaller } from "./callerResolution.js";
import { notifyUser, notifyStatusChange } from "./notify.js";
import { suggestClosestUsername } from "./usernameSuggest.js";
import { parseStatusWord, VALID_STATUS_WORDS_TEXT } from "./statusParse.js";
import { parseRefListItems, parseUpdateItems, type BatchItem } from "./updateBatch.js";
import {
  chunkMessage,
  formatAllTasksGrouped,
  formatDeadlines,
  formatHelp,
  statusLabel,
  STATUS_EMOJI,
} from "./format.js";
import { buildStandup, formatStandup } from "./standup.js";
import type { Caller, TaskStatus } from "../domain/types.js";
import { isPastDate } from "../domain/overdue.js";
import type { Roster } from "../domain/roster.js";

export interface CreateBotOptions {
  token: string;
  /** Storage port TaskService talks to (ADR-0005). Production code passes a
   * `SupabaseTaskStore`; tests pass an `InMemoryTaskStore`. */
  taskStore: TaskStorePort;
  /** Storage port for the Telegram-user-id <-> roster-username link
   * (PRD §7). Production code passes a `SupabaseRegistrationStore`; tests
   * pass an `InMemoryRegistrationStore`. */
  registrationStore: RegistrationStorePort;
  /** The cohort this deployed bot instance serves (ADR-0004/CONTEXT.md's
   * cohort-binding note). Every real deployment serves exactly one
   * cohort — the real cohort or the dry-run cohort, never both — so
   * caller resolution is always bound to this id rather than letting
   * `roster.find` guess ambiguously among cohorts that happen to share a
   * username (the dry run intentionally reuses real accounts across
   * cohorts). */
  activeCohortId: string;
  dashboardUrl: string;
  /** Storage port `resolveCaller`'s auto-registration writes to (ADR-0013):
   * anyone who messages the bot gets a roster row in this cohort on first
   * contact. Production code passes a `SupabaseRosterStore`; tests pass an
   * `InMemoryRosterStore`. */
  rosterStore: RosterStorePort;
  /** Injected Bot instance — used by tests to avoid a real network `getMe`
   * call and to intercept outgoing API calls via `bot.api.config.use(...)`.
   * Production code always omits this and gets a freshly constructed Bot. */
  bot?: Bot;
  /** The in-process roster, kept current by `resolveCaller`'s
   * auto-registration and (per-request) `webhookHandler.ts`'s refresh.
   * Production code loads this via `loadRosterFromStore`; tests construct
   * one directly. */
  roster: Roster;
}

/** Appended to a reply when a resolved due date is already in the past
 * (issue #56 F10) — a warning, not a rejection: backdating a task is
 * legitimate. */
const PAST_DUE_WARNING = "⚠️ That due date is already in the past.";

/** Per-status next-step hint appended to a task detail reply (#27's status
 * table) — any roster member may move a task to any status, so every hint
 * just suggests the obvious next command. Plain text, no Markdown: the bot
 * sends no `parse_mode` anywhere, so backticks would render literally
 * instead of as code formatting (H5). */
const NEXT_STEP_HINT: Record<TaskStatus, string> = {
  backlog: "Send /update <id> todo to move it to To do status.",
  todo: "Send /update <id> in progress once you start it.",
  in_progress: "Send /done <id> when you're ready for review.",
  in_review: "It's waiting for review. Send /complete <id> to mark it Done.",
  blocked: "Send /unblock <id> once it's unblocked.",
  done: "Nice work!",
};

export interface CreatedBot {
  bot: Bot;
  service: TaskService;
  roster: Roster;
  registrations: RegistrationStorePort;
}

/** Telegram's command-autocomplete menu — Devie's exact 10-command surface
 * (#106/ADR-0013), replacing this bot's old 21. `completed` is a real menu
 * entry, not just an alias handled silently, since Devie's own menu lists
 * both `/complete` and `/completed`. */
export const BOT_COMMANDS = [
  { command: "start", description: "Say hello and register yourself" },
  { command: "help", description: "Show the commands available to you" },
  { command: "tasks", description: "List cohort tasks, optionally filtered by @username" },
  { command: "deadlines", description: "Open tasks due in the next 7 days" },
  { command: "addtask", description: "Create a task in one line" },
  { command: "done", description: "Mark a task In review" },
  { command: "complete", description: "Mark a task Done" },
  { command: "completed", description: "Mark a task Done" },
  { command: "update", description: "Set a task's status (or bulk-update several)" },
  { command: "standup", description: "On-demand standup report for the cohort" },
] as const;

/** Every command name this bot actually handles via `bot.command(...)`
 * below — used by the edited-message guard (issue #63, finding H6) to
 * decide whether an incoming `/word` is a command that's actually going to
 * run, so it can be told "I don't pick up edits" rather than silently
 * ignored. No redirect handlers any more (#106) — removed means removed. */
export const HANDLED_COMMANDS: ReadonlySet<string> = new Set(BOT_COMMANDS.map((c) => c.command));

/** Registers `BOT_COMMANDS` with Telegram so the client's command-
 * autocomplete menu is populated. Idempotent: safe to call on every cold
 * start, since it just overwrites Telegram's stored list with the same
 * values when nothing changed. */
export async function registerBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([...BOT_COMMANDS]);
}

export function createBot(options: CreateBotOptions): CreatedBot {
  const bot = options.bot ?? new Bot(options.token);
  const roster = options.roster;
  const registrations = options.registrationStore;
  const clock = new SystemClock();
  // TaskService talks only through the TaskStorePort (ADR-0005) — see
  // bot/index.ts for how production wires this to SupabaseTaskStore.
  const service = new TaskService(options.taskStore, roster, clock);

  const NEEDS_USERNAME_TEXT =
    "You'll need a Telegram username first — set one in Telegram's settings, then try again.";

  /** Auto-registers the sender (ADR-0013 — matches Devie's `syncMember`:
   * insert on first contact, update on every later one, no gate of any
   * kind) and resolves them to a service-layer `Caller`. The only failure
   * left is a Telegram account with no username set, since both the
   * registration and roster rows are keyed by username. */
  async function requireCaller(ctx: import("grammy").Context): Promise<Caller | undefined> {
    const from = ctx.from;
    if (!from) return undefined;
    const resolved = await resolveCaller(
      { id: from.id, username: from.username },
      registrations,
      options.rosterStore,
      roster,
      options.activeCohortId,
    );
    if (resolved.status === "no_username") {
      await ctx.reply(NEEDS_USERNAME_TEXT);
      return undefined;
    }
    return resolved.caller;
  }

  function withCaller(
    handler: (ctx: import("grammy").Context, caller: Caller) => Promise<void>,
  ) {
    return async (ctx: import("grammy").Context) => {
      const caller = await requireCaller(ctx);
      if (!caller) return;
      await handler(ctx, caller);
    };
  }

  // ---- Outermost error guard (issue #49/#50, finding F1/D1) -------------
  // Registered first: the webhook path (bot.handleUpdate) never consults
  // bot.catch (see grammy's bot.js handleUpdate, which rethrows as a
  // BotError instead of routing to the error handler — only the
  // long-polling bot.start() path does that). Without this guard, any
  // thrown error escapes handleTelegramWebhook as a 500 after the update
  // id has already been claimed for dedup, so Telegram never retries and
  // the user gets no reply at all.
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error(err);
      try {
        await ctx.reply(
          "Something went wrong on my end — that didn't go through. Try again in a moment.",
        );
      } catch (replyErr) {
        console.error(replyErr);
      }
    }
  });

  // ---- /start -----------------------------------------------------------
  // Devie's version (#106/ADR-0013): register the sender and say hello.
  // No role question, no group-membership check — auto-registration
  // already happened inside requireCaller by the time this runs.

  bot.command(
    "start",
    withCaller(async (ctx, caller) => {
      await ctx.reply(
        `Hey @${caller.username}! You're set up for ${caller.cohortId} — send /help anytime to see what I can do.`,
      );
    }),
  );

  // ---- /help ------------------------------------------------------------

  bot.command(
    "help",
    withCaller(async (ctx) => {
      await ctx.reply(formatHelp());
    }),
  );

  /** Sends `text` as one or more Telegram-sized messages (issue #55/F8):
   * several unbounded list commands could otherwise throw
   * `Bad Request: message is too long`. */
  async function replyChunked(ctx: import("grammy").Context, text: string): Promise<void> {
    for (const chunk of chunkMessage(text)) {
      await ctx.reply(chunk);
    }
  }

  // ---- /tasks -------------------------------------------------------------

  const TASKS_USAGE = "Usage: /tasks [page], or /tasks @username";

  bot.command(
    "tasks",
    withCaller(async (ctx, caller) => {
      const parsed = parseTasksArgs(ctx.match);
      if (parsed.kind === "error") {
        await ctx.reply(TASKS_USAGE);
        return;
      }
      if (parsed.kind === "all") {
        const result = await service.listAllTasks(caller);
        await replyChunked(ctx, result.ok ? formatAllTasksGrouped(result.value, parsed.page) : result.error);
        return;
      }
      const result = await service.listTasksForMember(caller, parsed.username);
      await replyChunked(
        ctx,
        result.ok
          ? formatAllTasksGrouped(result.value, parsed.page, `@${normalizeUsername(parsed.username)}`)
          : result.error,
      );
    }),
  );

  bot.command(
    "deadlines",
    withCaller(async (ctx, caller) => {
      const result = await service.listDeadlines(caller);
      await replyChunked(ctx, result.ok ? formatDeadlines(result.value) : result.error);
    }),
  );

  bot.command(
    "standup",
    withCaller(async (ctx, caller) => {
      const report = await buildStandup(service, caller, clock.now());
      await replyChunked(ctx, formatStandup(report));
    }),
  );

  // ---- Status-setting commands (issue #27/#31 — replaces the review gate)

  /** Sets `status` on `id` and applies the shared status-change notification
   * policy (issue #27/#29): DM the assignee and creator, skipping the actor.
   * Shared by `/update`, `/done`, and `/complete`/`/completed` — all three
   * are just this with a different fixed or parsed status and reply text. */
  async function applyStatusChange(
    caller: Caller,
    id: number,
    status: TaskStatus,
    ctx: import("grammy").Context,
    replySuffix: string,
  ) {
    const result = await service.setStatus(caller, id, status);
    if (!result.ok) {
      await ctx.reply(result.error);
      return;
    }
    await ctx.reply(`Task ${id} ${replySuffix}`);
    await notifyStatusChange(
      bot,
      registrations,
      result.value,
      caller.username,
      `Task ${id} ("${result.value.title}") status changed to ${STATUS_EMOJI[status]} ${statusLabel(status)} by @${caller.username}. Send /update ${id} <status> to change it again.`,
    );
  }

  const UPDATE_USAGE = `Usage: /update <ref> <status> — status is one of: ${VALID_STATUS_WORDS_TEXT}`;

  interface BatchOutcome {
    label: string;
    ok: boolean;
    message: string;
    task?: { assigneeUsername: string; assignedByUsername: string; title: string };
    status?: TaskStatus;
  }

  /** Runs one `setStatus` call per batch item (issue #32) — no batch
   * transaction, on purpose: the storage port has no multi-statement
   * transaction primitive, and per-item semantics match what a chat user
   * expects from a list of instructions. `resolveStatus` lets each caller
   * (`/update` parses a status per item, `/done`/`/complete` use a fixed
   * one) plug in its own status resolution without duplicating the loop. */
  async function runBatch(
    caller: Caller,
    items: BatchItem[],
    resolveStatus: (item: BatchItem) => { status: TaskStatus } | { error: string },
  ): Promise<BatchOutcome[]> {
    const outcomes: BatchOutcome[] = [];
    for (const item of items) {
      if (item.ref === undefined) {
        outcomes.push({ label: `"${item.label}"`, ok: false, message: "not a valid task ref" });
        continue;
      }
      const label = `t${item.ref}`;
      const resolved = resolveStatus(item);
      if ("error" in resolved) {
        outcomes.push({ label, ok: false, message: resolved.error });
        continue;
      }
      const result = await service.setStatus(caller, item.ref, resolved.status);
      if (!result.ok) {
        outcomes.push({ label, ok: false, message: result.error });
        continue;
      }
      outcomes.push({
        label,
        ok: true,
        message: statusLabel(resolved.status),
        task: result.value,
        status: resolved.status,
      });
    }
    return outcomes;
  }

  /** Notification collapsing (issue #27/#32) — the sharpest edge in the
   * spec: a naive per-item loop would fire one DM per task, so a
   * `/update t21,...,t40 done` aimed at one assignee would send them
   * twenty DMs. Gather every successful outcome's notification across the
   * whole batch, group by recipient, and send exactly one summary DM per
   * recipient per command. */
  async function sendBatchNotifications(caller: Caller, outcomes: BatchOutcome[]): Promise<void> {
    const perRecipient = new Map<string, string[]>();
    for (const outcome of outcomes) {
      if (!outcome.ok || !outcome.task || !outcome.status) continue;
      const recipients = new Set([outcome.task.assigneeUsername, outcome.task.assignedByUsername]);
      recipients.delete(caller.username);
      for (const username of recipients) {
        const changes = perRecipient.get(username) ?? [];
        changes.push(`${outcome.label} ("${outcome.task.title}") → ${statusLabel(outcome.status)}`);
        perRecipient.set(username, changes);
      }
    }
    for (const [username, changes] of perRecipient) {
      const text = `@${caller.username} updated ${changes.length} of your tasks:\n${changes.join("\n")}`;
      await notifyUser(bot, registrations, username, text);
    }
  }

  /** Replies with partial-failure reporting (issue #32): a wholly-invalid
   * batch gets usage help instead of a wall of identical errors; otherwise
   * every item gets a ✓/✗ line and a one-line summary, then notifications
   * fire once the reply is sent. */
  async function finishBatch(
    ctx: import("grammy").Context,
    caller: Caller,
    outcomes: BatchOutcome[],
    usageText: string,
  ): Promise<void> {
    if (outcomes.every((o) => !o.ok)) {
      await ctx.reply(usageText);
    } else {
      const successCount = outcomes.filter((o) => o.ok).length;
      const lines = outcomes.map((o) => (o.ok ? `${o.label} ✓ ${o.message}` : `${o.label} ✗ ${o.message}`));
      const header = `${successCount}/${outcomes.length} updated.`;
      for (const chunk of chunkMessage([header, ...lines].join("\n"))) {
        await ctx.reply(chunk);
      }
    }
    await sendBatchNotifications(caller, outcomes);
  }

  bot.command(
    "update",
    withCaller(async (ctx, caller) => {
      const raw = matchToString(ctx.match).trim();
      const items = parseUpdateItems(raw);
      if (items.length === 0) {
        await ctx.reply(UPDATE_USAGE);
        return;
      }
      if (items.length === 1) {
        const item = items[0]!;
        if (item.ref === undefined) {
          await ctx.reply(UPDATE_USAGE);
          return;
        }
        const statusText = item.statusText ?? "";
        if (statusText.trim().length === 0) {
          await ctx.reply(UPDATE_USAGE);
          return;
        }
        const status = parseStatusWord(statusText);
        if (!status) {
          await ctx.reply(
            `I don't recognize "${statusText.trim()}" as a status — valid ones are: ${VALID_STATUS_WORDS_TEXT}`,
          );
          return;
        }
        await applyStatusChange(caller, item.ref, status, ctx, `set to ${STATUS_EMOJI[status]} ${statusLabel(status)}.`);
        return;
      }
      const outcomes = await runBatch(caller, items, (item) => {
        const statusText = item.statusText ?? "";
        const status = parseStatusWord(statusText);
        return status ? { status } : { error: `unrecognized status "${statusText.trim()}"` };
      });
      await finishBatch(ctx, caller, outcomes, UPDATE_USAGE);
    }),
  );

  // Devie parity's deliberate wart (issue #27): `/done` sets `in_review`
  // while `/update <ref> done` sets `done`. Copied on purpose — do not fix.
  bot.command(
    "done",
    withCaller(async (ctx, caller) => {
      const raw = matchToString(ctx.match).trim();
      const items = parseRefListItems(raw);
      if (items.length === 0) {
        await ctx.reply("Usage: /done <ref>");
        return;
      }
      if (items.length === 1) {
        const item = items[0]!;
        if (item.ref === undefined) {
          await ctx.reply("Usage: /done <ref>");
          return;
        }
        await applyStatusChange(caller, item.ref, "in_review", ctx, "is now 👀 In review. Nice work!");
        return;
      }
      const outcomes = await runBatch(caller, items, () => ({ status: "in_review" }));
      await finishBatch(ctx, caller, outcomes, "Usage: /done <ref>");
    }),
  );

  /** Shared by `/complete` and `/completed` — Devie has both as real menu
   * entries (verified fact in #106), not one command with a silent alias. */
  const completeHandler = withCaller(async (ctx: import("grammy").Context, caller: Caller) => {
    const raw = matchToString(ctx.match).trim();
    const items = parseRefListItems(raw);
    if (items.length === 0) {
      await ctx.reply("Usage: /complete <ref>");
      return;
    }
    if (items.length === 1) {
      const item = items[0]!;
      if (item.ref === undefined) {
        await ctx.reply("Usage: /complete <ref>");
        return;
      }
      await applyStatusChange(caller, item.ref, "done", ctx, "marked ✅ Done. Nice work!");
      return;
    }
    const outcomes = await runBatch(caller, items, () => ({ status: "done" }));
    await finishBatch(ctx, caller, outcomes, "Usage: /complete <ref>");
  });

  bot.command("complete", completeHandler);
  bot.command("completed", completeHandler);

  // ---- /addtask (one-liner; bare command gets a usage example, Devie-style,
  // not the removed step-by-step form) ------------------------------------

  function memberUsernamesInCohort(cohortId: string): string[] {
    return roster
      .all()
      .filter((entry) => entry.cohortId === cohortId)
      .map((entry) => entry.username);
  }

  function unknownRosterMemberReply(username: string, cohortId: string): string {
    const suggestion = suggestClosestUsername(username, memberUsernamesInCohort(cohortId));
    const suggestionText = suggestion ? ` Did you mean @${suggestion}?` : "";
    return `I don't see @${username} on this cohort's roster.${suggestionText}`;
  }

  // Shared by `/addtask <args>` and the mention trigger (issue #34, which
  // reuses #30's create grammar verbatim rather than re-implementing it).
  async function handleAddTaskArgs(
    ctx: import("grammy").Context,
    caller: Caller,
    raw: string,
  ) {
    const parsed = parseAddTaskArgs(raw, new Date());
    if ("error" in parsed) {
      await ctx.reply(parsed.error);
      return;
    }

    let assigneeUsername = caller.username;
    if (parsed.assigneeUsername) {
      const requested = parsed.assigneeUsername.replace(/^@/, "");
      if (!roster.isMember(requested, caller.cohortId)) {
        await ctx.reply(unknownRosterMemberReply(requested, caller.cohortId));
        return;
      }
      assigneeUsername = requested;
    }

    const dueDate = parsed.dueDate?.isoDate ?? comingFriday(new Date()).isoDate;
    const result = await service.assignTask(caller, {
      assigneeUsername,
      title: parsed.title,
      dueDate,
    });
    if (!result.ok) {
      await ctx.reply(`Couldn't create the task: ${result.error}`);
      return;
    }
    let reply = `Task ${result.value.id} created and assigned to @${result.value.assigneeUsername}, due ${result.value.dueDate}.`;
    if (isPastDate(result.value.dueDate, new Date())) {
      reply += `\n${PAST_DUE_WARNING}`;
    }
    if (result.value.assigneeUsername !== normalizeUsername(caller.username)) {
      const notified = await notifyUser(
        bot,
        registrations,
        result.value.assigneeUsername,
        `You've been assigned Task ${result.value.id}: "${result.value.title}" (due ${result.value.dueDate}). Send /done ${result.value.id} when you're ready for review.`,
      );
      if (!notified) {
        reply += `\nHeads-up: @${result.value.assigneeUsername} hasn't messaged me yet, so I couldn't notify them.`;
      }
    }
    await ctx.reply(reply);
  }

  bot.command(
    "addtask",
    withCaller(async (ctx, caller) => {
      const raw = matchToString(ctx.match).trim();
      if (raw.length === 0) {
        // Devie's bare /addtask: a usage example, not a step-by-step form
        // (#106 — the wizard system is gone entirely).
        await ctx.reply(ADDTASK_USAGE);
        return;
      }
      await handleAddTaskArgs(ctx, caller, raw);
    }),
  );

  // ---- Free-text handling (mention trigger + unrecognized-command fallback)

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      // Reaching here means no bot.command() handler above matched it —
      // i.e. an unrecognized/removed command name. No stack trace, no
      // special-cased redirect (#106 — removed means removed): this is
      // the same generic fallback any other unaddressed text gets.
      if (ctx.chat.type === "private" && !isAddressedToOtherBot(text, bot.botInfo.username)) {
        await ctx.reply("Not sure what you're asking — try /help to see what I can do.");
      }
      return;
    }

    // Mention trigger (issue #34): checked ahead of the DM-only fallback
    // below, since it's meant to fire in group chatter too — but only on
    // an explicit @-mention, never on unmentioned text, which is why
    // "none" falls through to the same silent-in-groups behavior as
    // before.
    const trigger = parseMentionTrigger(text, bot.botInfo.username);
    if (trigger.kind === "unrecognized") {
      await ctx.reply(`Did you mean to create a task? Try: @${bot.botInfo.username} add task <title>`);
      return;
    }
    if (trigger.kind === "addtask") {
      const caller = await requireCaller(ctx);
      if (!caller) return;
      await handleAddTaskArgs(ctx, caller, trigger.args);
      return;
    }
    // With privacy mode off, the bot sees every message in a group chat,
    // not just ones meant for it — only DMs can assume every message is
    // addressed to the bot, so only reply with the fallback there.
    if (ctx.chat.type === "private") {
      await ctx.reply("Not sure what you're asking — try /help to see what I can do.");
    }
  });

  // ---- Edited commands are acknowledged, never executed (issue #65,
  // finding H14; decision D11 in #59) ------------------------------------
  // An edit arrives as a new update with a fresh update_id, so the
  // processed_telegram_updates dedup (ADR-0004) does not suppress it.
  // Running the command again on edit would double-execute it. Accepted
  // consequence: editing the same message three times produces three
  // nudges, one per update.
  bot.on("edited_message:text", async (ctx) => {
    const text = ctx.editedMessage.text;
    if (!text.startsWith("/")) return;
    if (isAddressedToOtherBot(text, bot.botInfo.username)) return;
    const commandName = parseCommandName(text);
    if (!HANDLED_COMMANDS.has(commandName)) return;
    await ctx.reply("I don't pick up edits — send that as a new message.");
  });

  return { bot, service, roster, registrations };
}

/** Parses the leading `/word` of a message into a lowercase command name
 * with the `/` and any `@botname` suffix stripped (issue #63, finding H6) —
 * e.g. `/Help@test_bot foo` -> `help`. Used to check the token against
 * `HANDLED_COMMANDS` before treating it as a real command. */
function parseCommandName(text: string): string {
  const token = text.slice(1).split(/\s/, 1)[0] ?? "";
  const atIndex = token.indexOf("@");
  const withoutBotname = atIndex === -1 ? token : token.slice(0, atIndex);
  return withoutBotname.toLowerCase();
}

/** True when a leading `/command@othername` is explicitly addressed to a
 * different bot (issue #52) — checked so this bot doesn't reply to chatter
 * meant for someone else in a group chat. */
function isAddressedToOtherBot(text: string, botUsername: string): boolean {
  const commandToken = text.slice(1).split(/\s/, 1)[0] ?? "";
  const atIndex = commandToken.indexOf("@");
  return (
    atIndex !== -1 &&
    commandToken.slice(atIndex + 1).toLowerCase() !== botUsername.toLowerCase()
  );
}

type CommandMatch = string | RegExpMatchArray | undefined;

function matchToString(match: CommandMatch): string {
  if (match === undefined) return "";
  return typeof match === "string" ? match : (match[0] ?? "");
}

type TasksArgs =
  | { kind: "all"; page: number }
  | { kind: "member"; username: string; page: number }
  | { kind: "error" };

/** Parses `/tasks`'s single-argument grammar (issue #27/#33, trimmed of its
 * role filter by #106 — there is no role any more): a bare page number
 * means "next page" of the unfiltered list, while `@username` is a filter,
 * optionally followed by its own page number. */
function parseTasksArgs(match: CommandMatch): TasksArgs {
  const trimmed = matchToString(match).trim();
  if (trimmed.length === 0) return { kind: "all", page: 1 };
  const tokens = trimmed.split(/\s+/);
  const [first, second] = tokens;

  if (/^\d+$/.test(first!)) {
    if (tokens.length > 1) return { kind: "error" };
    const page = Number(first);
    return page >= 1 ? { kind: "all", page } : { kind: "error" };
  }

  let page = 1;
  if (second !== undefined) {
    if (!/^\d+$/.test(second) || tokens.length > 2) return { kind: "error" };
    const parsedPage = Number(second);
    if (parsedPage < 1) return { kind: "error" };
    page = parsedPage;
  }

  if (first!.startsWith("@")) {
    return { kind: "member", username: first!.slice(1), page };
  }
  return { kind: "error" };
}
