import { Bot, InlineKeyboard } from "grammy";
import { loadRoster } from "../config/roster.js";
import { normalizeUsername } from "../domain/roster.js";
import { SystemClock } from "../domain/clock.js";
import { TaskService } from "../service/taskService.js";
import type { TaskStorePort } from "../storage/taskStorePort.js";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { WizardStateStorePort } from "../storage/wizardStateStorePort.js";
import { comingFriday, parseDueDate } from "../date/parseDueDate.js";
import { ADDTASK_USAGE, parseAddTaskArgs } from "./addTaskParse.js";
import { parseMentionTrigger } from "./mentionParse.js";
import { resolveCaller } from "./callerResolution.js";
import { WizardManager, type WizardState, type EditField } from "./wizard.js";
import { notifyUser, notifyStatusChange } from "./notify.js";
import { suggestClosestUsername } from "./usernameSuggest.js";
import { parseTaskRef } from "./taskRef.js";
import { parseStatusWord, VALID_STATUS_WORDS_TEXT } from "./statusParse.js";
import { parseRefListItems, parseUpdateItems, type BatchItem } from "./updateBatch.js";
import {
  formatAllTasksGrouped,
  formatBacklog,
  formatBlocked,
  formatDeadlines,
  formatHelp,
  formatMyTasks,
  formatPending,
  formatTaskDetail,
  statusLabel,
} from "./format.js";
import { buildStandup, formatStandup } from "./standup.js";
import type { Caller, Role, TaskStatus } from "../domain/types.js";
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
  /** Storage port for in-progress bare-/addtask and bare-/edit wizard state
   * (ADR-0006). Production code passes a `SupabaseWizardStateStore`; tests
   * pass an `InMemoryWizardStateStore`. */
  wizardStateStore: WizardStateStorePort;
  /** The cohort this deployed bot instance serves (ADR-0004/CONTEXT.md's
   * cohort-binding note). Every real deployment serves exactly one
   * cohort — the real cohort or the dry-run cohort, never both — so
   * caller resolution is always bound to this id rather than letting
   * `roster.find` guess ambiguously among cohorts that happen to share a
   * username (the dry run intentionally reuses real accounts across
   * cohorts). */
  activeCohortId: string;
  rosterPath?: string;
  dashboardUrl: string;
  /** Injected Bot instance — used by tests to avoid a real network `getMe`
   * call and to intercept outgoing API calls via `bot.api.config.use(...)`.
   * Production code always omits this and gets a freshly constructed Bot. */
  bot?: Bot;
  /** Injected Roster — used by tests to seed roster data without reading a
   * config file from disk. Production code always omits this. */
  roster?: Roster;
}

/** Per-status next-step hint appended to `/task <id>`'s detail reply (#27's
 * status table). There's no more gated "you can't act on this" case — any
 * roster member may move a task to any status — so every hint just
 * suggests the obvious next command rather than describing a permission. */
const NEXT_STEP_HINT: Record<TaskStatus, string> = {
  backlog: "Send `/update <id> todo` to move it to To do status.",
  todo: "Send `/done <id>` once you start it.",
  in_progress: "Send `/done <id>` when you're done.",
  in_review: "It's now awaiting review. Send `/complete <id>` to mark it Done.",
  blocked: "Send `/unblock <id>` once it's unblocked.",
  done: "Nice work!",
};

export interface CreatedBot {
  bot: Bot;
  service: TaskService;
  roster: Roster;
  registrations: RegistrationStorePort;
  wizards: WizardManager;
}

/** Telegram's command-autocomplete menu (issue #27/#35) — descriptions
 * mirror `formatHelp`'s EVERYONE_HELP list one-for-one, kept short since
 * Telegram truncates the menu entry. Excludes the removed-command redirect
 * handlers below (e.g. `/submit`, `/backlog`) on purpose: those exist only
 * to point old muscle memory at the replacement, not to be offered as live
 * commands. */
export const BOT_COMMANDS = [
  { command: "start", description: "Register yourself against the roster" },
  { command: "help", description: "Show the commands available to you" },
  { command: "cancel", description: "Abort an in-progress wizard" },
  { command: "addtask", description: "Create a task in one line, or start the step-by-step form" },
  { command: "tasks", description: "List cohort tasks, optionally filtered by @username or role" },
  { command: "mytasks", description: "Show your open tasks" },
  { command: "task", description: "Show full detail on one task" },
  { command: "update", description: "Set a task's status (or bulk-update several)" },
  { command: "done", description: "Mark a task In review" },
  { command: "complete", description: "Mark a task Done" },
  { command: "overdue", description: "List overdue tasks" },
  { command: "pending", description: "Review queue (tasks In review)" },
  { command: "deadlines", description: "Open tasks due in the next 7 days" },
  { command: "standup", description: "On-demand standup report for the cohort" },
  { command: "blocked", description: "List blocked tasks, or flag one as blocked" },
  { command: "unblock", description: "Restore a blocked task to its previous status" },
  { command: "note", description: "Attach a feedback note to a task" },
  { command: "edit", description: "Edit a task's assignee, title, description, or due date (higher-ups only)" },
  { command: "dashboard", description: "Get the dashboard link" },
] as const;

/** Registers `BOT_COMMANDS` with Telegram so the client's command-
 * autocomplete menu is populated (issue #27/#35 — this had never been
 * called anywhere in the repo before this stage). Idempotent: safe to call
 * on every cold start, since it just overwrites Telegram's stored list with
 * the same values when nothing changed. */
export async function registerBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([...BOT_COMMANDS]);
}

export function createBot(options: CreateBotOptions): CreatedBot {
  const bot = options.bot ?? new Bot(options.token);
  const roster = options.roster ?? loadRoster(options.rosterPath);
  const registrations = options.registrationStore;
  const clock = new SystemClock();
  // TaskService talks only through the TaskStorePort (ADR-0005) — see
  // bot/index.ts for how production wires this to SupabaseTaskStore.
  const service = new TaskService(options.taskStore, roster, clock);
  const wizards = new WizardManager(options.wizardStateStore);

  function requireCaller(userId: number) {
    return resolveCaller(userId, registrations, roster, options.activeCohortId);
  }

  // ---- /start ---------------------------------------------------------

  // ---- Mid-wizard command interruption (PRD §6) --------------------------
  // Registered first so it fires ahead of every command handler below,
  // including /start: sending any recognized command while a wizard is in
  // progress is treated as an implicit "never mind" that auto-cancels the
  // wizard, then the actual command still runs normally.

  bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    const userId = ctx.from?.id;
    if (
      text &&
      text.startsWith("/") &&
      userId !== undefined &&
      !text.toLowerCase().startsWith("/cancel") &&
      (await wizards.has(userId))
    ) {
      await wizards.cancel(userId);
      await ctx.reply(
        "Cancelled your in-progress form since you sent a new command.",
      );
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    const from = ctx.from;
    const username = from?.username;
    if (!username || !from) {
      await ctx.reply(
        "You don't have a Telegram username set. Set one in Telegram's " +
          "settings, then send /start again.",
      );
      return;
    }
    const entry = roster.find(username, options.activeCohortId);
    if (!entry) {
      await ctx.reply(
        "You're not on the roster yet — contact a higher-up to get added.",
      );
      return;
    }
    await registrations.register(from.id, username);
    await ctx.reply(
      `Welcome, @${entry.username}! You're registered as ${entry.role === "HigherUp" ? "a higher-up" : "an intern"} for ${entry.cohortId}. Send /help to see what you can do.`,
    );
  });

  // ---- /help ------------------------------------------------------------

  bot.command("help", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const resolved = await requireCaller(userId);
    await ctx.reply(
      formatHelp(resolved.status === "ok" ? resolved.caller.role : undefined),
    );
  });

  // ---- /cancel ------------------------------------------------------------

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const had = await wizards.cancel(userId);
    await ctx.reply(had ? "Cancelled." : "Nothing to cancel.");
  });

  // ---- /dashboard ---------------------------------------------------------

  bot.command("dashboard", async (ctx) => {
    await ctx.reply(`Dashboard: ${options.dashboardUrl}`);
  });

  // ---- Not-registered guard for everything else below --------------------

  async function resolveCallerOrReply(
    ctx: import("grammy").Context,
  ): Promise<Caller | undefined> {
    const userId = ctx.from?.id;
    if (userId === undefined) return undefined;
    const resolved = await requireCaller(userId);
    if (resolved.status === "not_started") {
      await ctx.reply("Send /start first so I know who you are.");
      return undefined;
    }
    if (resolved.status === "not_on_roster") {
      await ctx.reply(
        "You're not on the roster yet — contact a higher-up to get added.",
      );
      return undefined;
    }
    return resolved.caller;
  }

  function withCaller(
    handler: (ctx: import("grammy").Context, caller: Caller) => Promise<void>,
  ) {
    return async (ctx: import("grammy").Context) => {
      const caller = await resolveCallerOrReply(ctx);
      if (!caller) return;
      await handler(ctx, caller);
    };
  }

  // ---- Read-only commands ---------------------------------------------

  // /alltasks is renamed /tasks (issue #27/#33), gaining @username and role
  // filters. No alias retained ("no installed base", #27) — same pattern
  // as /backlog -> /overdue below.
  bot.command(
    "alltasks",
    withCaller(async (ctx) => {
      await ctx.reply("/alltasks is now /tasks.");
    }),
  );

  const TASKS_USAGE = "Usage: /tasks [page], /tasks @username, or /tasks intern|higherup";

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
        await ctx.reply(result.ok ? formatAllTasksGrouped(result.value, parsed.page) : result.error);
        return;
      }
      if (parsed.kind === "member") {
        const result = await service.listTasksForMember(caller, parsed.username);
        await ctx.reply(
          result.ok
            ? formatAllTasksGrouped(result.value, parsed.page, `@${normalizeUsername(parsed.username)}`)
            : result.error,
        );
        return;
      }
      const result = await service.listTasksForRole(caller, parsed.role);
      await ctx.reply(
        result.ok
          ? formatAllTasksGrouped(
              result.value,
              parsed.page,
              parsed.role === "Intern" ? "intern" : "higherup",
            )
          : result.error,
      );
    }),
  );

  bot.command(
    "mytasks",
    withCaller(async (ctx, caller) => {
      const page = parsePageArg(ctx.match);
      if (page === undefined) {
        await ctx.reply("Usage: /mytasks [page]");
        return;
      }
      const result = await service.listMyTasks(caller);
      await ctx.reply(result.ok ? formatMyTasks(result.value, page) : result.error);
    }),
  );

  bot.command(
    "overdue",
    withCaller(async (ctx, caller) => {
      const result = await service.listBacklog(caller);
      await ctx.reply(result.ok ? formatBacklog(result.value) : result.error);
    }),
  );

  // /backlog is renamed to /overdue (issue #27/#31) — "backlog" is now a
  // real status, so a command meaning "overdue" under that name is a
  // guaranteed misfire. No alias retained ("no installed base", #27).
  bot.command(
    "backlog",
    withCaller(async (ctx) => {
      await ctx.reply("/backlog is now /overdue.");
    }),
  );

  bot.command(
    "pending",
    withCaller(async (ctx, caller) => {
      const result = await service.listPending(caller);
      await ctx.reply(result.ok ? formatPending(result.value) : result.error);
    }),
  );

  bot.command(
    "deadlines",
    withCaller(async (ctx, caller) => {
      const result = await service.listDeadlines(caller);
      await ctx.reply(result.ok ? formatDeadlines(result.value) : result.error);
    }),
  );

  bot.command(
    "standup",
    withCaller(async (ctx, caller) => {
      const report = await buildStandup(service, caller, clock.now());
      await ctx.reply(formatStandup(report));
    }),
  );

  bot.command(
    "task",
    withCaller(async (ctx, caller) => {
      const id = parseIdArg(ctx.match);
      if (id === undefined) {
        await ctx.reply("Usage: /task <task_id>");
        return;
      }
      const result = await service.getTask(caller, id);
      if (!result.ok) {
        await ctx.reply(result.error);
        return;
      }
      await ctx.reply(`${formatTaskDetail(result.value)}\n\n${NEXT_STEP_HINT[result.value.status]}`);
    }),
  );

  // ---- Status-setting commands (issue #27/#31 — replaces the review gate)

  /** Sets `status` on `id` and applies the shared status-change notification
   * policy (issue #27/#29): DM the assignee and creator, skipping the actor.
   * Shared by `/update`, `/done`, and `/complete` — all three are just this
   * with a different fixed or parsed status and reply text. */
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
      `Task ${id} ("${result.value.title}") status changed to ${statusLabel(status)} by @${caller.username}. Send /task ${id} for details.`,
    );
  }

  const UPDATE_USAGE = `Usage: /update <ref> <status> — status is one of: ${VALID_STATUS_WORDS_TEXT}`;
  const TELEGRAM_MESSAGE_LIMIT = 4096;

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

  /** Splits a per-item reply into Telegram-sized chunks (issue #32
   * acceptance: a large batch must chunk or summarise, never silently
   * truncate) rather than one long string that could exceed the 4096-char
   * message limit. */
  function chunkBatchReply(header: string, lines: string[]): string[] {
    const chunks: string[] = [];
    let current = header;
    for (const line of lines) {
      if (current.length + 1 + line.length > TELEGRAM_MESSAGE_LIMIT - 100) {
        chunks.push(current);
        current = line;
      } else {
        current += "\n" + line;
      }
    }
    chunks.push(current);
    return chunks;
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
      for (const chunk of chunkBatchReply(header, lines)) {
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
        const status = parseStatusWord(statusText);
        if (!status) {
          await ctx.reply(
            `I don't recognize "${statusText.trim()}" as a status. Valid statuses: ${VALID_STATUS_WORDS_TEXT}`,
          );
          return;
        }
        await applyStatusChange(caller, item.ref, status, ctx, `set to ${statusLabel(status)}.`);
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
        await applyStatusChange(caller, item.ref, "in_review", ctx, "marked as submitted. Nice work!");
        return;
      }
      const outcomes = await runBatch(caller, items, () => ({ status: "in_review" }));
      await finishBatch(ctx, caller, outcomes, "Usage: /done <ref>");
    }),
  );

  bot.command(
    "complete",
    withCaller(async (ctx, caller) => {
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
        await applyStatusChange(caller, item.ref, "done", ctx, "marked Done. Nice work!");
        return;
      }
      const outcomes = await runBatch(caller, items, () => ({ status: "done" }));
      await finishBatch(ctx, caller, outcomes, "Usage: /complete <ref>");
    }),
  );

  bot.command(
    "unblock",
    withCaller(async (ctx, caller) => {
      const id = parseIdArg(ctx.match);
      if (id === undefined) {
        await ctx.reply("Usage: /unblock <ref>");
        return;
      }
      const result = await service.clearBlocked(caller, id);
      await ctx.reply(result.ok ? `Task ${id} is no longer blocked.` : result.error);
    }),
  );

  // ---- Removed commands: helpful redirects, not the generic fallback ----
  // No aliases retained ("no installed base", issue #27) — these just point
  // whoever's muscle memory hits them at the replacement, since the dry-run
  // exercise is exactly where that muscle memory lives (issue #31).

  bot.command(
    "submit",
    withCaller(async (ctx) => {
      await ctx.reply("/submit is gone — use /done <ref> instead.");
    }),
  );

  bot.command(
    "approve",
    withCaller(async (ctx) => {
      await ctx.reply("/approve is gone — use /complete <ref> instead.");
    }),
  );

  bot.command(
    "revise",
    withCaller(async (ctx) => {
      await ctx.reply("/revise is gone — use /update <ref> todo instead.");
    }),
  );

  bot.command(
    "canceltask",
    withCaller(async (ctx) => {
      await ctx.reply("/canceltask is gone — use /update <ref> backlog instead.");
    }),
  );

  bot.command(
    "unblocked",
    withCaller(async (ctx) => {
      await ctx.reply("/unblocked is gone — use /unblock <ref> instead.");
    }),
  );

  // `/blocked` is dual-purpose: with no arguments it's the read-only
  // cohort/own blocked-task list (issue #6); with `<task_id> <reason>` it
  // flags a task as blocked (PRD §5). Both share the same command name, so
  // dispatch on whether any argument text was given.
  bot.command(
    "blocked",
    withCaller(async (ctx, caller) => {
      if (matchToString(ctx.match).trim().length === 0) {
        const result = await service.listBlocked(caller);
        await ctx.reply(result.ok ? formatBlocked(result.value) : result.error);
        return;
      }
      const { id, rest } = parseIdAndRest(ctx.match);
      if (id === undefined || rest.trim().length === 0) {
        await ctx.reply("Usage: /blocked <task_id> <reason>, or /blocked with no arguments to list blocked tasks");
        return;
      }
      const result = await service.setBlocked(caller, id, rest);
      if (!result.ok) {
        await ctx.reply(result.error);
        return;
      }
      await ctx.reply(`Task ${id} flagged as blocked.`);
      await notifyStatusChange(
        bot,
        registrations,
        result.value,
        caller.username,
        `Task ${id} ("${result.value.title}", @${result.value.assigneeUsername}) was flagged as blocked: ${result.value.blockedReason}`,
      );
    }),
  );

  // ---- Higher-up commands: simple ones ------------------------------------

  bot.command(
    "note",
    withCaller(async (ctx, caller) => {
      const { id, rest } = parseIdAndRest(ctx.match);
      if (id === undefined || rest.trim().length === 0) {
        await ctx.reply("Usage: /note <task_id> <text>");
        return;
      }
      const result = await service.addNote(caller, id, rest);
      if (!result.ok) {
        await ctx.reply(result.error);
        return;
      }
      await ctx.reply(`Note added to Task ${id}.`);
      await notifyUser(
        bot,
        registrations,
        result.value.assigneeUsername,
        `New note on Task ${id} ("${result.value.title}") from @${caller.username}: ${rest}`,
      );
    }),
  );

  // `/approve`, `/revise`, and `/canceltask` (with its Yes/No confirmation
  // and the `canceltask:` callback) are removed outright, not retargeted
  // (issue #27/#31) — see the helpful-redirect commands above.

  // ---- /addtask (one-liner, with wizard fallback) and /edit wizard ----

  // Assignable to any roster member, not just interns (issue #27/#29).
  function memberUsernamesInCohort(cohortId: string): string[] {
    return roster
      .all()
      .filter((entry) => entry.cohortId === cohortId)
      .map((entry) => entry.username);
  }

  function unknownRosterMemberReply(username: string, cohortId: string): string {
    const suggestion = suggestClosestUsername(username, memberUsernamesInCohort(cohortId));
    const suggestionText = suggestion ? ` Did you mean @${suggestion}?` : "";
    return `@${username} isn't a known roster member in this cohort.${suggestionText}`;
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
    await ctx.reply(
      `Task ${result.value.id} created and assigned to @${result.value.assigneeUsername}, due ${result.value.dueDate}.`,
    );
    if (result.value.assigneeUsername !== normalizeUsername(caller.username)) {
      await notifyUser(
        bot,
        registrations,
        result.value.assigneeUsername,
        `You've been assigned Task ${result.value.id}: "${result.value.title}" (due ${result.value.dueDate}). Send /task ${result.value.id} for full details.`,
      );
    }
  }

  bot.command(
    "addtask",
    withCaller(async (ctx, caller) => {
      const raw = matchToString(ctx.match).trim();
      if (raw.length === 0) {
        await wizards.start(ctx.from!.id, "assign");
        await ctx.reply(
          "Who is this task for? Type @ to pick from Telegram's suggestions, or just send their username.",
        );
        return;
      }
      await handleAddTaskArgs(ctx, caller, raw);
    }),
  );

  bot.command(
    "edit",
    withCaller(async (ctx, caller) => {
      if (caller.role !== "HigherUp") {
        await ctx.reply("Only higher-ups can edit tasks.");
        return;
      }
      const { id, rest } = parseIdAndRest(ctx.match);
      if (id === undefined) {
        await ctx.reply(
          "Usage: /edit <task_id>, or /edit <task_id> <field> <value> — field is assignee, title, description, or duedate.",
        );
        return;
      }
      const found = await service.getTask(caller, id);
      if (!found.ok) {
        await ctx.reply(found.error);
        return;
      }

      if (rest.length === 0) {
        await wizards.start(ctx.from!.id, "edit", { taskId: id });
        const keyboard = new InlineKeyboard()
          .text("Assignee", "editfield:assignee")
          .text("Title", "editfield:title")
          .row()
          .text("Description", "editfield:description")
          .text("Due date", "editfield:duedate");
        await ctx.reply(
          `Editing Task ${id} ("${found.value.title}"). Which field do you want to change?`,
          { reply_markup: keyboard },
        );
        return;
      }

      // Direct single-field edit: /edit <task_id> <field> <value>.
      const spaceIdx = rest.indexOf(" ");
      const fieldToken = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
      const value = (spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1)).trim();
      const field = parseEditField(fieldToken);
      if (!field || value.length === 0) {
        await ctx.reply(
          "Usage: /edit <task_id> <field> <value> — field is assignee, title, description, or duedate.",
        );
        return;
      }

      const patch: Record<string, string> = {};
      if (field === "assignee") {
        const username = value.replace(/^@/, "");
        if (!roster.isMember(username, caller.cohortId)) {
          await ctx.reply(unknownRosterMemberReply(username, caller.cohortId));
          return;
        }
        patch.assigneeUsername = username;
      } else if (field === "title") {
        patch.title = value;
      } else if (field === "description") {
        patch.description = value;
      } else {
        const parsedDate = parseDueDate(value, new Date());
        if (!parsedDate) {
          await ctx.reply(
            'I couldn\'t understand that date. Try phrases like "next Friday", "in 3 days", or "Sept 5".',
          );
          return;
        }
        patch.dueDate = parsedDate.isoDate;
      }

      const result = await service.editTask(caller, id, patch);
      if (!result.ok) {
        await ctx.reply(`Couldn't save the edit: ${result.error}`);
        return;
      }
      const fieldLabel: Record<EditField, string> = {
        assignee: "assignee",
        title: "title",
        description: "description",
        dueDate: "due date",
      };
      await ctx.reply(`Task ${id} updated — ${fieldLabel[field]} changed.`);
    }),
  );

  // ---- /edit field-choice menu -----------------------------------------

  bot.callbackQuery(/^editfield:(assignee|title|description|duedate)$/, async (ctx) => {
    const userId = ctx.from.id;
    const state = await wizards.get(userId);
    if (!state || state.step !== "awaiting_field_choice") {
      await ctx.answerCallbackQuery({ text: "That form has expired." });
      return;
    }
    const resolved = await requireCaller(userId);
    if (resolved.status !== "ok") {
      await ctx.answerCallbackQuery({ text: "Send /start first." });
      return;
    }
    const found = await service.getTask(resolved.caller, state.data.taskId!);
    if (!found.ok) {
      await wizards.cancel(userId);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(found.error);
      return;
    }
    const task = found.value;
    const [, fieldParam] = ctx.match as unknown as [string, string];
    await ctx.answerCallbackQuery();

    if (fieldParam === "assignee") {
      await wizards.update(userId, {
        step: "awaiting_assignee",
        data: { editField: "assignee" },
      });
      await ctx.editMessageText(
        `Task ${task.id} is currently assigned to @${task.assigneeUsername}. New assignee (type @ for suggestions), or send their username:`,
      );
      return;
    }
    if (fieldParam === "title") {
      await wizards.update(userId, {
        step: "awaiting_title",
        data: { editField: "title" },
      });
      await ctx.editMessageText(
        `Task ${task.id}'s current title is "${task.title}". New title:`,
      );
      return;
    }
    if (fieldParam === "description") {
      await wizards.update(userId, {
        step: "awaiting_description",
        data: { editField: "description" },
      });
      await ctx.editMessageText(
        `Task ${task.id}'s current description is "${task.description ?? "(none)"}". New description:`,
      );
      return;
    }
    // duedate
    await wizards.update(userId, {
      step: "awaiting_due_date",
      data: { editField: "dueDate" },
    });
    await ctx.editMessageText(
      `Task ${task.id} is currently due ${task.dueDate}. New due date (e.g. "next Friday", "in 3 days", "Sept 5"):`,
    );
  });

  // ---- Free-text wizard step handling --------------------------------

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      // Reaching here means no bot.command() handler above matched it —
      // i.e. an unrecognized command (PRD §6).
      await ctx.reply("Not sure what you mean — try /help");
      return;
    }
    const userId = ctx.from.id;
    const state = await wizards.get(userId);
    if (!state) {
      // Mention trigger (issue #34): checked ahead of the DM-only fallback
      // below, since it's meant to fire in group chatter too — but only on
      // an explicit @-mention, never on unmentioned text, which is why
      // "none" falls through to the same silent-in-groups behavior as
      // before.
      const trigger = parseMentionTrigger(text, bot.botInfo.username);
      if (trigger.kind === "unrecognized") {
        await ctx.reply(`Not sure what you mean — did you mean /addtask <title>? ${ADDTASK_USAGE}`);
        return;
      }
      if (trigger.kind === "addtask") {
        const caller = await resolveCallerOrReply(ctx);
        if (!caller) return;
        await handleAddTaskArgs(ctx, caller, trigger.args);
        return;
      }
      // With privacy mode off, the bot sees every message in a group chat,
      // not just ones meant for it — only DMs can assume every message is
      // addressed to the bot, so only reply with the fallback there.
      if (ctx.chat.type === "private") {
        await ctx.reply("Not sure what you mean — try /help");
      }
      return;
    }
    const resolved = await requireCaller(userId);
    if (resolved.status !== "ok") {
      await wizards.cancel(userId);
      await ctx.reply("Send /start first.");
      return;
    }
    await handleWizardInput(ctx, resolved.caller, state, text.trim());
  });

  async function handleWizardInput(
    ctx: import("grammy").Context,
    caller: Caller,
    state: WizardState,
    text: string,
  ) {
    const userId = ctx.from!.id;

    if (state.step === "awaiting_field_choice") {
      await ctx.reply("Please tap a button above to choose a field, or send /cancel.");
      return;
    }

    if (state.step === "awaiting_assignee") {
      const username = text.replace(/^@/, "");
      if (!roster.isMember(username, caller.cohortId)) {
        // Assignable to any roster member, not just interns (issue #27/#29).
        const memberUsernames = roster
          .all()
          .filter((entry) => entry.cohortId === caller.cohortId)
          .map((entry) => entry.username);
        const suggestion = suggestClosestUsername(username, memberUsernames);
        const suggestionText = suggestion ? ` Did you mean @${suggestion}?` : "";
        await ctx.reply(
          `@${username} isn't a known roster member in this cohort.${suggestionText} Try again, or /cancel.`,
        );
        return;
      }
      const updated = (await wizards.update(userId, {
        data: { assigneeUsername: username },
      }))!;
      if (state.kind === "edit") {
        await finishWizard(ctx, caller, userId, updated);
        return;
      }
      await wizards.update(userId, { step: "awaiting_title" });
      await ctx.reply("Title?");
      return;
    }

    if (state.step === "awaiting_title") {
      if (text.length === 0) {
        await ctx.reply("Title can't be empty. Try again, or /cancel.");
        return;
      }
      const updated = (await wizards.update(userId, { data: { title: text } }))!;
      if (state.kind === "edit") {
        await finishWizard(ctx, caller, userId, updated);
        return;
      }
      await wizards.update(userId, { step: "awaiting_description" });
      await ctx.reply(
        state.kind === "assign"
          ? 'Description? (optional — send "skip" to leave it blank)'
          : "Description?",
      );
      return;
    }

    if (state.step === "awaiting_description") {
      // Description is optional (issue #27/#28) — the create wizard lets
      // it be skipped; the edit wizard's description step is reached only
      // by explicitly choosing to change it, so it stays required there.
      const skipped = state.kind === "assign" && text.toLowerCase() === "skip";
      if (!skipped && text.length === 0) {
        await ctx.reply("Description can't be empty. Try again, or /cancel.");
        return;
      }
      const updated = (
        await wizards.update(userId, { data: { description: skipped ? undefined : text } })
      )!;
      if (state.kind === "edit") {
        await finishWizard(ctx, caller, userId, updated);
        return;
      }
      await wizards.update(userId, { step: "awaiting_due_date" });
      await ctx.reply('Due date? (e.g. "next Friday", "in 3 days", "Sept 5")');
      return;
    }

    if (state.step === "awaiting_due_date") {
      const parsed = parseDueDate(text, new Date());
      if (!parsed) {
        await ctx.reply(
          "I couldn't understand that date. Try phrases like \"next Friday\", \"in 3 days\", or \"Sept 5\", or /cancel.",
        );
        return;
      }
      await wizards.update(userId, {
        step: "awaiting_due_date_confirm",
        data: { pendingDueDate: parsed },
      });
      const keyboard = new InlineKeyboard().text("Yes", "duedate:yes").text("No", "duedate:no");
      await ctx.reply(`That's ${parsed.friendly}. Save this?`, {
        reply_markup: keyboard,
      });
      return;
    }

    // awaiting_due_date_confirm expects a button tap, not text.
    await ctx.reply('Please tap "Yes" or "No" above, or send /cancel.');
  }

  bot.callbackQuery(/^duedate:(yes|no)$/, async (ctx) => {
    const userId = ctx.from.id;
    const state = await wizards.get(userId);
    if (!state || state.step !== "awaiting_due_date_confirm") {
      await ctx.answerCallbackQuery({ text: "That form has expired." });
      return;
    }
    const resolved = await requireCaller(userId);
    if (resolved.status !== "ok") {
      await ctx.answerCallbackQuery({ text: "Send /start first." });
      return;
    }
    const [, decision] = ctx.match as unknown as [string, string];
    await ctx.answerCallbackQuery();

    if (decision === "no") {
      await wizards.update(userId, { step: "awaiting_due_date" });
      await ctx.editMessageText(
        'Okay — send the due date again (e.g. "next Friday", "in 3 days", "Sept 5"):',
      );
      return;
    }

    const finalState = (await wizards.update(userId, {
      data: { dueDate: state.data.pendingDueDate!.isoDate },
    }))!;
    await ctx.editMessageText(`Saved: ${state.data.pendingDueDate!.friendly}`);
    await finishWizard(ctx, resolved.caller, userId, finalState);
  });

  async function finishWizard(
    ctx: import("grammy").Context,
    caller: Caller,
    userId: number,
    state: WizardState,
  ) {
    await wizards.cancel(userId);

    if (state.kind === "assign") {
      const result = await service.assignTask(caller, {
        assigneeUsername: state.data.assigneeUsername!,
        title: state.data.title!,
        description: state.data.description,
        dueDate: state.data.dueDate!,
      });
      if (!result.ok) {
        await ctx.reply(`Couldn't create the task: ${result.error}`);
        return;
      }
      await ctx.reply(`Task ${result.value.id} created and assigned to @${result.value.assigneeUsername}.`);
      await notifyUser(
        bot,
        registrations,
        result.value.assigneeUsername,
        `You've been assigned Task ${result.value.id}: "${result.value.title}" (due ${result.value.dueDate}). Send /task ${result.value.id} for full details, /submit ${result.value.id} when done.`,
      );
      return;
    }

    // edit
    const patch: Record<string, string> = {};
    if (state.data.assigneeUsername) patch.assigneeUsername = state.data.assigneeUsername;
    if (state.data.title) patch.title = state.data.title;
    if (state.data.description) patch.description = state.data.description;
    if (state.data.dueDate) patch.dueDate = state.data.dueDate;

    const result = await service.editTask(caller, state.data.taskId!, patch);
    if (!result.ok) {
      await ctx.reply(`Couldn't save the edit: ${result.error}`);
      return;
    }
    const fieldLabel: Record<EditField, string> = {
      assignee: "assignee",
      title: "title",
      description: "description",
      dueDate: "due date",
    };
    const label = state.data.editField ? fieldLabel[state.data.editField] : "task";
    await ctx.reply(`Task ${state.data.taskId} updated — ${label} changed.`);
  }

  return { bot, service, roster, registrations, wizards };
}

type CommandMatch = string | RegExpMatchArray | undefined;

function matchToString(match: CommandMatch): string {
  if (match === undefined) return "";
  return typeof match === "string" ? match : (match[0] ?? "");
}

/** Accepts both `23` and `t23` (issue #27/#31's shared task-ref grammar). */
function parseIdArg(match: CommandMatch): number | undefined {
  return parseTaskRef(matchToString(match));
}

/** Page-number argument for /alltasks and /mytasks (issue #7). No argument
 * defaults to page 1; a non-numeric or non-positive argument is rejected
 * with a usage message rather than silently falling back — an
 * out-of-range-but-valid page number (e.g. past the last page) is instead
 * clamped by `paginate` in format.ts, since that's a page that once
 * existed and just ran out, not a malformed request. */
function parsePageArg(match: CommandMatch): number | undefined {
  const trimmed = matchToString(match).trim();
  if (trimmed.length === 0) return 1;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const page = Number(trimmed);
  return page >= 1 ? page : undefined;
}

type TasksArgs =
  | { kind: "all"; page: number }
  | { kind: "member"; username: string; page: number }
  | { kind: "role"; role: Role; page: number }
  | { kind: "error" };

/** Parses `/tasks`'s single-argument grammar (issue #27/#33): a bare page
 * number means "next page" of the unfiltered list, while `@username` or a
 * role word (`intern`/`higherup`) is a filter, optionally followed by its
 * own page number — `/tasks 2` must still mean page 2 of the unfiltered
 * list (CONTEXT.md's noted parsing ambiguity), so a bare numeric first
 * token is only ever treated as a page number, never a filter. */
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
  const roleWord = first!.toLowerCase();
  if (roleWord === "intern") return { kind: "role", role: "Intern", page };
  if (roleWord === "higherup") return { kind: "role", role: "HigherUp", page };
  return { kind: "error" };
}

function parseIdAndRest(match: CommandMatch): { id: number | undefined; rest: string } {
  const trimmed = matchToString(match).trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    return { id: parseIdArg(trimmed), rest: "" };
  }
  const idPart = trimmed.slice(0, spaceIdx);
  const rest = trimmed.slice(spaceIdx + 1).trim();
  return { id: parseIdArg(idPart), rest };
}

/** Field-name token accepted by `/edit <task_id> <field> <value>` — matches
 * the same four fields as the `editfield:` callback data, so "duedate"
 * (one word, lowercase) is the accepted spelling rather than "dueDate". */
function parseEditField(token: string): EditField | undefined {
  const normalized = token.toLowerCase();
  if (normalized === "assignee") return "assignee";
  if (normalized === "title") return "title";
  if (normalized === "description") return "description";
  if (normalized === "duedate" || normalized === "due-date" || normalized === "due_date") {
    return "dueDate";
  }
  return undefined;
}
