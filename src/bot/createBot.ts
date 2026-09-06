import { Bot, GrammyError } from "grammy";
import { normalizeUsername } from "../domain/roster.js";
import { SystemClock } from "../domain/clock.js";
import { TaskService } from "../service/taskService.js";
import type { TaskStorePort } from "../storage/taskStorePort.js";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { RosterStorePort } from "../storage/rosterStorePort.js";
import { comingFriday, getNextOnsiteDay, parseDueDate } from "../date/parseDueDate.js";
import { parseAddTaskArgs, parseTrailingAddTask, ADDTASK_USAGE } from "./addTaskParse.js";
import { parseMentionTrigger } from "./mentionParse.js";
import { resolveCaller } from "./callerResolution.js";
import { notifyUser, notifyStatusChange } from "./notify.js";
import { suggestClosestUsername } from "./usernameSuggest.js";
import { parseStatusWord, VALID_STATUS_WORDS_TEXT } from "./statusParse.js";
import { parseRefListItems, parseUpdateItems, type BatchItem } from "./updateBatch.js";
import {
  shouldTriggerBulkCreate,
  resolveBulkAssignee,
  formatBulkCreateReply,
  type BulkCreatedTask,
} from "./bulkTaskCreate.js";
import {
  resolveAllMembers,
  resolveRoleMembers,
  formatAllAssignedReply,
  formatRoleAssignedReply,
  NO_MEMBERS_TO_ASSIGN_REPLY,
} from "./fanOut.js";
import { parseBulkTasks } from "../nlp/parse.js";
import type { TextModel } from "../nlp/textModel.js";
import {
  chunkMessage,
  formatDeadlines,
  formatHelp,
  statusLabel,
  STATUS_EMOJI,
} from "./format.js";
import {
  buildStandup,
  buildStandupKeyboard,
  formatStandupFiltered,
  parseStandupCallback,
} from "./standup.js";
import {
  buildTasksPage,
  fetchTaskPages,
  parseTasksCallback,
  parseTasksFilter,
  type InlineKeyboardMarkup,
} from "./tasksPage.js";
import type { Caller, Task, TaskPriority, TaskStatus } from "../domain/types.js";
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
  /** Language-model port (issue #102) `parseBulkTasks` (issue #104's
   * paste-in bulk task capture) is grounded against — production wires the
   * account's currently-funded `GroqTextModel`; tests pass a
   * `FakeTextModel`/`ThrowingTextModel` so the suite makes no network
   * calls. */
  model: TextModel;
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

  // ---- /tasks — Devie's paged, button-driven browser (#103 items 1/2) ----
  // Replaces the wall-of-text `formatAllTasksGrouped` reply and its
  // `/tasks <page>` argument: paging is the inline keyboard's job now, one
  // page per member, edited in place. See `tasksPage.ts`.

  /** Sends a page-plus-keyboard card. `parse_mode: "HTML"` is scoped to
   * exactly these two views (`/tasks` and `/standup`'s keyboard card),
   * because Devie's `/tasks` text is copied verbatim and is HTML — every
   * other reply in this bot is still plain text with no parse_mode. */
  async function sendCard(
    ctx: import("grammy").Context,
    text: string,
    keyboard: InlineKeyboardMarkup,
    html: boolean,
  ): Promise<void> {
    await ctx.reply(text, {
      ...(html ? { parse_mode: "HTML" as const } : {}),
      reply_markup: keyboard,
    });
  }

  /** Edits a card in place, falling back to a fresh message if the edit is
   * refused — Devie's `editWithKeyboard` (`route.ts:85-105`), including its
   * treatment of Telegram's "message is not modified" 400 as success, which
   * is what clicking the page you are already on produces. */
  async function editCard(
    ctx: import("grammy").Context,
    text: string,
    keyboard: InlineKeyboardMarkup,
    html: boolean,
  ): Promise<void> {
    const options = {
      ...(html ? { parse_mode: "HTML" as const } : {}),
      reply_markup: keyboard,
    };
    try {
      await ctx.editMessageText(text, options);
    } catch (err) {
      if (err instanceof GrammyError && err.description.includes("message is not modified")) {
        return;
      }
      console.error(err);
      await ctx.reply(text, options);
    }
  }

  bot.command(
    "tasks",
    withCaller(async (ctx, caller) => {
      const filter = parseTasksFilter(matchToString(ctx.match));
      const { pages, allRoles } = await fetchTaskPages(service, caller, roster, filter);
      const { text, keyboard } = buildTasksPage(pages, 0, filter.roleFilter, allRoles);
      await sendCard(ctx, text, keyboard, true);
    }),
  );

  bot.command(
    "deadlines",
    withCaller(async (ctx, caller) => {
      const result = await service.listDeadlines(caller);
      await replyChunked(ctx, result.ok ? formatDeadlines(result.value) : result.error);
    }),
  );

  // `/standup` gains Devie's five filter buttons (#103 item 3). It stays
  // plain text — only `/tasks` copies Devie's HTML — so the keyboard is the
  // whole change here; the overview body is the existing `formatStandup`.
  bot.command(
    "standup",
    withCaller(async (ctx, caller) => {
      const report = await buildStandup(service, caller, clock.now());
      await sendCard(
        ctx,
        formatStandupFiltered(report, "overview"),
        buildStandupKeyboard(report, "overview"),
        false,
      );
    }),
  );

  // ---- Inline-button presses (#103 items 1 and 3) ------------------------
  // Both cards are re-rendered from a fresh fetch and edited in place, then
  // the callback is answered so the client stops showing a spinner —
  // Devie's `route.ts:629-677`. No permission check of any kind: anyone in
  // the chat may page or filter anyone's list (#103 rule 3), and the only
  // boundary is `TaskService`'s cohort scoping, which both fetches go
  // through.
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    const tasksCb = parseTasksCallback(data);
    if (tasksCb) {
      const caller = await requireCaller(ctx);
      if (caller) {
        const { pages, allRoles } = await fetchTaskPages(service, caller, roster, {
          roleFilter: tasksCb.roleFilter,
          assigneeFilter: null,
        });
        const { text, keyboard } = buildTasksPage(
          pages,
          tasksCb.page,
          tasksCb.roleFilter,
          allRoles,
        );
        await editCard(ctx, text, keyboard, true);
      }
    }

    const standupCb = parseStandupCallback(data);
    if (standupCb) {
      const caller = await requireCaller(ctx);
      if (caller) {
        const report = await buildStandup(service, caller, clock.now());
        await editCard(
          ctx,
          formatStandupFiltered(report, standupCb.filter),
          buildStandupKeyboard(report, standupCb.filter),
          false,
        );
      }
    }

    await ctx.answerCallbackQuery();
  });

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
    meta?: BatchItem,
  ) {
    const result = await service.setStatus(caller, id, status);
    if (!result.ok) {
      await ctx.reply(result.error);
      return;
    }
    const metaSuffix = meta ? await attachUpdateMeta(caller, id, meta) : "";
    await ctx.reply(`Task ${id} ${replySuffix}${metaSuffix}`);
    await notifyStatusChange(
      bot,
      registrations,
      result.value,
      caller.username,
      `Task ${id} ("${result.value.title}") status changed to ${STATUS_EMOJI[status]} ${statusLabel(status)} by @${caller.username}. Send /update ${id} <status> to change it again.`,
    );
  }

  /**
   * Attaches `/update`'s `link:<url>` / `note:<text>` riders to a task and
   * returns the suffix Devie appends to the reply line for them (issue #103
   * item 6, `route.ts:1092-1100`). Devie stores both as ordinary
   * `task_comments` rows — the link first, then the note — which is exactly
   * this repo's `addNote`, so there is no new storage shape here. No
   * permission check: `addNote` is already cohort-scoped in `TaskService`,
   * and this runs only after `setStatus` on the same task has succeeded.
   */
  async function attachUpdateMeta(
    caller: Caller,
    id: number,
    item: BatchItem,
  ): Promise<string> {
    let suffix = "";
    if (item.link) {
      await service.addNote(caller, id, item.link);
      suffix += `\n  🔗 ${item.link}`;
    }
    if (item.note) {
      await service.addNote(caller, id, item.note);
      suffix += `\n  📝 ${item.note}`;
    }
    return suffix;
  }

  const UPDATE_USAGE = `Usage: /update <ref> <status> — status is one of: ${VALID_STATUS_WORDS_TEXT}`;

  interface BatchOutcome {
    label: string;
    ok: boolean;
    message: string;
    task?: { assigneeUsername: string; assignedByUsername: string; title: string };
    status?: TaskStatus;
    /** The `🔗`/`📝` lines for this item's `/update` riders (#103 item 6),
     * appended to its ✓ line by `finishBatch`. Always `""` for
     * `/done`/`/complete`, whose grammar has no riders. */
    metaSuffix?: string;
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
        metaSuffix: await attachUpdateMeta(caller, item.ref, item),
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
      const lines = outcomes.map((o) =>
        o.ok ? `${o.label} ✓ ${o.message}${o.metaSuffix ?? ""}` : `${o.label} ✗ ${o.message}`,
      );
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
        await applyStatusChange(
          caller,
          item.ref,
          status,
          ctx,
          `set to ${STATUS_EMOJI[status]} ${statusLabel(status)}.`,
          item,
        );
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

  /**
   * Devie's `/addtask` bulk branch (issue #104,
   * `app/api/telegram/webhook/route.ts:1133-1165` @ `632a22c`): hands the
   * raw body to `parseBulkTasks` and inserts every extracted task through
   * `TaskService.assignBulkTask` — no roster validation on the assignee
   * (carbon-copy rule 2: a name matching nobody creates an orphan task, on
   * purpose), no confirmation step, no batch atomicity (carbon-copy rule
   * 3): every task that can be created is, independently of the others.
   * `resolveBulkAssignee` maps `parseBulkTasks`'s `"unassigned"` sentinel
   * onto the message's own sender, same as Devie's `authorAssignee`
   * fallback; the sender is otherwise never consulted for an assignee.
   */
  async function handleBulkAddTask(
    ctx: import("grammy").Context,
    caller: Caller,
    raw: string,
  ) {
    const parsed = await parseBulkTasks(raw, options.model, new Date());
    if (parsed.length === 0) {
      await ctx.reply("❌ Could not extract any tasks from that message.");
      return;
    }

    const created: BulkCreatedTask[] = [];
    for (const task of parsed) {
      const assigneeUsername = resolveBulkAssignee(task.assignee, caller.username);
      const dueDate = task.dueDate ?? getNextOnsiteDay(new Date()).isoDate;
      const result = await service.assignBulkTask(caller, {
        assigneeUsername,
        title: task.title,
        description: task.description ?? undefined,
        dueDate,
        priority: task.priority,
      });
      if (result.ok) {
        created.push({
          id: result.value.id,
          title: result.value.title,
          assigneeUsername: result.value.assigneeUsername,
          dueDate: result.value.dueDate,
          description: result.value.description,
        });
      }
    }

    if (created.length === 0) {
      await ctx.reply("❌ Something went wrong while creating the tasks. Please try again.");
      return;
    }

    await ctx.reply(formatBulkCreateReply(created), { parse_mode: "HTML" as const });
  }

  /**
   * Devie's `@all`/role fan-out for the single-mention `/addtask` grammar
   * (issue #104, `route.ts:1201-1269`): creates one task per resolved
   * member via the ordinary, roster-validated `assignTask` (every member in
   * `members` is already a real roster entry, so the check always passes),
   * then replies with Devie's grouped confirmation.
   */
  async function createFanOutTasks(
    caller: Caller,
    members: string[],
    title: string,
    dueDate: string,
    priority: TaskPriority | undefined,
  ): Promise<Task[]> {
    const created: Task[] = [];
    for (const username of members) {
      const result = await service.assignTask(caller, {
        assigneeUsername: username,
        title,
        dueDate,
        priority,
      });
      if (result.ok) created.push(result.value);
    }
    return created;
  }

  // Shared by `/addtask <args>` and the mention trigger (issue #34, which
  // reuses #30's create grammar verbatim rather than re-implementing it).
  async function handleAddTaskArgs(
    ctx: import("grammy").Context,
    caller: Caller,
    raw: string,
  ) {
    // Bulk-paste detection (issue #104) — checked ahead of every other
    // `/addtask` parsing, same as Devie's own ordering.
    if (shouldTriggerBulkCreate(raw)) {
      await handleBulkAddTask(ctx, caller, raw);
      return;
    }

    const parsed = parseAddTaskArgs(raw, new Date());
    if ("error" in parsed) {
      await ctx.reply(parsed.error);
      return;
    }

    let assigneeUsername = caller.username;
    if (parsed.assigneeUsername) {
      const requested = normalizeUsername(parsed.assigneeUsername.replace(/^@/, ""));

      // `@all` fan-out (issue #104, `route.ts:1202-1210`) — checked before
      // the ordinary roster-membership rejection below.
      if (requested === "all") {
        const members = resolveAllMembers(roster, caller.cohortId);
        if (members.length === 0) {
          await ctx.reply(NO_MEMBERS_TO_ASSIGN_REPLY);
          return;
        }
        const dueDate = parsed.dueDate?.isoDate ?? getNextOnsiteDay(new Date()).isoDate;
        const created = await createFanOutTasks(caller, members, parsed.title, dueDate, parsed.priority);
        if (created.length === 0) {
          await ctx.reply("❌ Something went wrong while creating the tasks. Please try again.");
          return;
        }
        await ctx.reply(formatAllAssignedReply(members, parsed.title), {
          parse_mode: "HTML" as const,
        });
        return;
      }

      // Role/cohort fan-out (issue #104, `route.ts:1237-1269`; issue #103
      // item 2 maps Devie's `role` onto `cohort_id`) — same ordering: only
      // falls through to the single-member lookup when no cohort matches
      // the token.
      const roleMembers = resolveRoleMembers(roster, requested);
      if (roleMembers.length > 0) {
        const dueDate = parsed.dueDate?.isoDate ?? getNextOnsiteDay(new Date()).isoDate;
        const created = await createFanOutTasks(caller, roleMembers, parsed.title, dueDate, parsed.priority);
        if (created.length === 0 || created[0] === undefined) {
          await ctx.reply("❌ Something went wrong while creating the tasks. Please try again.");
          return;
        }
        await ctx.reply(formatRoleAssignedReply(roleMembers, parsed.title, requested, created[0].id), {
          parse_mode: "HTML" as const,
        });
        return;
      }

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
      priority: parsed.priority,
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

    // Trailing `/addtask` (issue #103 item 4). Checked ahead of the
    // leading-slash branch below because Devie's guard only skips its own
    // ten commands: a message that opens with an *unrecognised* /word and
    // ends with a `/addtask` line still routes here, with the slash-word
    // swept into the task body. See parseTrailingAddTask for the regex and
    // why the newline is load-bearing.
    const trailingBody = parseTrailingAddTask(text, HANDLED_COMMANDS);
    if (trailingBody !== undefined) {
      const caller = await requireCaller(ctx);
      if (!caller) return;
      if (trailingBody.length === 0) {
        await ctx.reply(ADDTASK_USAGE);
        return;
      }
      await handleAddTaskArgs(ctx, caller, trailingBody);
      return;
    }

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
    if (trigger.kind === "usage") {
      // Devie rewrites the mention into a bare `/addtask` before dispatch,
      // so a phrase with no title behind it lands on the same usage example
      // `/addtask` alone gets (#103) — not the old "did you mean to create a
      // task?" nudge, which is gone along with every other reply Devie
      // doesn't send.
      await ctx.reply(ADDTASK_USAGE);
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


