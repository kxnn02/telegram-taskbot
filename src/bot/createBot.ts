import { Bot, InlineKeyboard } from "grammy";
import { openDatabase } from "../db/schema.js";
import { RegistrationRepository } from "../db/registrationRepository.js";
import { loadRoster } from "../config/roster.js";
import { SystemClock } from "../domain/clock.js";
import { TaskService } from "../service/taskService.js";
import { parseDueDate } from "../date/parseDueDate.js";
import { resolveCaller } from "./callerResolution.js";
import { WizardManager, type WizardState } from "./wizard.js";
import { notifyUser } from "./notify.js";
import {
  formatAllTasksGrouped,
  formatBacklog,
  formatHelp,
  formatMyTasks,
  formatPending,
  formatTaskDetail,
} from "./format.js";
import type { Caller } from "../domain/types.js";

export interface CreateBotOptions {
  token: string;
  dbPath: string;
  rosterPath?: string;
  dashboardUrl: string;
}

const NEXT_STEP_HINT: Record<string, string> = {
  Assigned: "Send `/task <id>` for full details.",
  InProgress: "Send `/submit <id>` when you're done.",
  Submitted: "It's now awaiting review.",
  NeedsRevision: "Take another look and `/submit <id>` again when ready.",
};

export interface CreatedBot {
  bot: Bot;
  db: ReturnType<typeof openDatabase>;
  service: TaskService;
  roster: ReturnType<typeof loadRoster>;
  registrations: RegistrationRepository;
}

export function createBot(options: CreateBotOptions): CreatedBot {
  const bot = new Bot(options.token);
  const db = openDatabase(options.dbPath);
  const roster = loadRoster(options.rosterPath);
  const registrations = new RegistrationRepository(db);
  const clock = new SystemClock();
  const service = new TaskService(db, roster, clock);
  const wizards = new WizardManager();

  function requireCaller(userId: number) {
    return resolveCaller(userId, registrations, roster);
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
      wizards.has(userId) &&
      !text.toLowerCase().startsWith("/cancel")
    ) {
      wizards.cancel(userId);
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
    const entry = roster.find(username);
    if (!entry) {
      await ctx.reply(
        "You're not on the roster yet — contact a higher-up to get added.",
      );
      return;
    }
    registrations.register(from.id, username);
    await ctx.reply(
      `Welcome, @${entry.username}! You're registered as ${entry.role === "HigherUp" ? "a higher-up" : "an intern"} for ${entry.cohortId}. Send /help to see what you can do.`,
    );
  });

  // ---- /help ------------------------------------------------------------

  bot.command("help", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const resolved = requireCaller(userId);
    await ctx.reply(
      formatHelp(resolved.status === "ok" ? resolved.caller.role : undefined),
    );
  });

  // ---- /cancel ------------------------------------------------------------

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const had = wizards.cancel(userId);
    await ctx.reply(had ? "Cancelled." : "Nothing to cancel.");
  });

  // ---- /dashboard ---------------------------------------------------------

  bot.command("dashboard", async (ctx) => {
    await ctx.reply(`Dashboard: ${options.dashboardUrl}`);
  });

  // ---- Not-registered guard for everything else below --------------------

  function withCaller(
    handler: (ctx: import("grammy").Context, caller: Caller) => Promise<void>,
  ) {
    return async (ctx: import("grammy").Context) => {
      const userId = ctx.from?.id;
      if (userId === undefined) return;
      const resolved = requireCaller(userId);
      if (resolved.status === "not_started") {
        await ctx.reply("Send /start first so I know who you are.");
        return;
      }
      if (resolved.status === "not_on_roster") {
        await ctx.reply(
          "You're not on the roster yet — contact a higher-up to get added.",
        );
        return;
      }
      await handler(ctx, resolved.caller);
    };
  }

  // ---- Read-only commands ---------------------------------------------

  bot.command(
    "alltasks",
    withCaller(async (ctx, caller) => {
      const result = service.listAllTasks(caller);
      await ctx.reply(result.ok ? formatAllTasksGrouped(result.value) : result.error);
    }),
  );

  bot.command(
    "mytasks",
    withCaller(async (ctx, caller) => {
      const result = service.listMyTasks(caller);
      await ctx.reply(result.ok ? formatMyTasks(result.value) : result.error);
    }),
  );

  bot.command(
    "backlog",
    withCaller(async (ctx, caller) => {
      const result = service.listBacklog(caller);
      await ctx.reply(result.ok ? formatBacklog(result.value) : result.error);
    }),
  );

  bot.command(
    "pending",
    withCaller(async (ctx, caller) => {
      const result = service.listPending(caller);
      await ctx.reply(result.ok ? formatPending(result.value) : result.error);
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
      const result = service.getTask(caller, id);
      await ctx.reply(result.ok ? formatTaskDetail(result.value) : result.error);
    }),
  );

  // ---- Intern commands ---------------------------------------------------

  bot.command(
    "submit",
    withCaller(async (ctx, caller) => {
      const id = parseIdArg(ctx.match);
      if (id === undefined) {
        await ctx.reply("Usage: /submit <task_id>");
        return;
      }
      const result = service.submitTask(caller, id);
      if (!result.ok) {
        await ctx.reply(result.error);
        return;
      }
      await ctx.reply(`Task ${id} marked as submitted. Nice work!`);
      const approveRevise = new InlineKeyboard()
        .text("Approve", `decision:approve:${id}`)
        .text("Revise", `decision:revise:${id}`);
      await notifyUser(
        bot,
        registrations,
        result.value.assignedByUsername,
        `@${result.value.assigneeUsername} submitted Task ${id}: "${result.value.title}". Send /task ${id} for details, or tap a button below.`,
        approveRevise,
      );
    }),
  );

  bot.command(
    "blocked",
    withCaller(async (ctx, caller) => {
      const { id, rest } = parseIdAndRest(ctx.match);
      if (id === undefined || rest.trim().length === 0) {
        await ctx.reply("Usage: /blocked <task_id> <reason>");
        return;
      }
      const result = service.setBlocked(caller, id, rest);
      if (!result.ok) {
        await ctx.reply(result.error);
        return;
      }
      await ctx.reply(`Task ${id} flagged as blocked.`);
      await notifyUser(
        bot,
        registrations,
        result.value.assignedByUsername,
        `Task ${id} ("${result.value.title}", @${result.value.assigneeUsername}) was flagged as blocked: ${result.value.blockedReason}`,
      );
    }),
  );

  bot.command(
    "unblocked",
    withCaller(async (ctx, caller) => {
      const id = parseIdArg(ctx.match);
      if (id === undefined) {
        await ctx.reply("Usage: /unblocked <task_id>");
        return;
      }
      const result = service.clearBlocked(caller, id);
      await ctx.reply(result.ok ? `Task ${id} is no longer blocked.` : result.error);
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
      const result = service.addNote(caller, id, rest);
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

  bot.command(
    "approve",
    withCaller(async (ctx, caller) => {
      const id = parseIdArg(ctx.match);
      if (id === undefined) {
        await ctx.reply("Usage: /approve <task_id>");
        return;
      }
      await decide(caller, id, "approve", ctx);
    }),
  );

  bot.command(
    "revise",
    withCaller(async (ctx, caller) => {
      const id = parseIdArg(ctx.match);
      if (id === undefined) {
        await ctx.reply("Usage: /revise <task_id>");
        return;
      }
      await decide(caller, id, "revise", ctx);
    }),
  );

  async function decide(
    caller: Caller,
    id: number,
    decision: "approve" | "revise",
    ctx: import("grammy").Context,
  ) {
    const result =
      decision === "approve"
        ? service.approveTask(caller, id)
        : service.reviseTask(caller, id);
    if (!result.ok) {
      await ctx.reply(result.error);
      return;
    }
    await ctx.reply(
      `Task ${id} marked ${decision === "approve" ? "Approved" : "Needs Revision"}.`,
    );
    const hint =
      decision === "approve"
        ? "Nice work!"
        : `Take another look and \`/submit ${id}\` again when ready.`;
    await notifyUser(
      bot,
      registrations,
      result.value.assigneeUsername,
      `Task ${id} ("${result.value.title}") was ${decision === "approve" ? "approved" : "sent back for revision"} by @${caller.username}. ${hint}`,
    );
  }

  // ---- /canceltask (with Yes/No confirmation) ------------------------

  bot.command(
    "canceltask",
    withCaller(async (ctx, caller) => {
      const id = parseIdArg(ctx.match);
      if (id === undefined) {
        await ctx.reply("Usage: /canceltask <task_id>");
        return;
      }
      const found = service.getTask(caller, id);
      if (!found.ok) {
        await ctx.reply(found.error);
        return;
      }
      const keyboard = new InlineKeyboard()
        .text("Yes, cancel it", `canceltask:yes:${id}`)
        .text("No", `canceltask:no:${id}`);
      await ctx.reply(
        `Cancel Task ${id} ("${found.value.title}")? This can't be undone.`,
        { reply_markup: keyboard },
      );
    }),
  );

  bot.callbackQuery(/^canceltask:(yes|no):(\d+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const resolved = requireCaller(userId);
    if (resolved.status !== "ok") {
      await ctx.answerCallbackQuery({ text: "Send /start first." });
      return;
    }
    const [, decision, idStr] = ctx.match as unknown as [string, string, string];
    const id = Number(idStr);
    if (decision === "no") {
      await ctx.answerCallbackQuery({ text: "Not cancelled." });
      await ctx.editMessageText(`Kept Task ${id} as-is.`);
      return;
    }
    const result = service.cancelTask(resolved.caller, id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      result.ok ? `Task ${id} cancelled.` : result.error,
    );
  });

  // ---- Approve/Revise inline buttons on submission notifications -------

  bot.callbackQuery(/^decision:(approve|revise):(\d+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const resolved = requireCaller(userId);
    if (resolved.status !== "ok" || resolved.caller.role !== "HigherUp") {
      await ctx.answerCallbackQuery({ text: "Only higher-ups can do that." });
      return;
    }
    const [, decision, idStr] = ctx.match as unknown as [string, string, string];
    const id = Number(idStr);
    const result =
      decision === "approve"
        ? service.approveTask(resolved.caller, id)
        : service.reviseTask(resolved.caller, id);
    await ctx.answerCallbackQuery();
    if (!result.ok) {
      await ctx.editMessageText(result.error);
      return;
    }
    await ctx.editMessageText(
      `Task ${id} marked ${decision === "approve" ? "Approved" : "Needs Revision"}.`,
    );
    const hint =
      decision === "approve"
        ? "Nice work!"
        : `Take another look and \`/submit ${id}\` again when ready.`;
    await notifyUser(
      bot,
      registrations,
      result.value.assigneeUsername,
      `Task ${id} ("${result.value.title}") was ${decision === "approve" ? "approved" : "sent back for revision"} by @${resolved.caller.username}. ${hint}`,
    );
  });

  // ---- Assignment wizard (/assign) and /edit wizard ------------------

  bot.command(
    "assign",
    withCaller(async (ctx, caller) => {
      if (caller.role !== "HigherUp") {
        await ctx.reply("Only higher-ups can assign tasks.");
        return;
      }
      wizards.start(ctx.from!.id, "assign");
      await ctx.reply(
        "Who is this task for? Send their Telegram username (without @).",
      );
    }),
  );

  bot.command(
    "edit",
    withCaller(async (ctx, caller) => {
      if (caller.role !== "HigherUp") {
        await ctx.reply("Only higher-ups can edit tasks.");
        return;
      }
      const id = parseIdArg(ctx.match);
      if (id === undefined) {
        await ctx.reply("Usage: /edit <task_id>");
        return;
      }
      const found = service.getTask(caller, id);
      if (!found.ok) {
        await ctx.reply(found.error);
        return;
      }
      wizards.start(ctx.from!.id, "edit", { taskId: id });
      await ctx.reply(
        `Editing Task ${id} ("${found.value.title}"). For each field, send a new value or "-" to keep it as-is.\n\n` +
          `New assignee username, or "-" to keep @${found.value.assigneeUsername}:`,
      );
    }),
  );

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
    const state = wizards.get(userId);
    if (!state) {
      // With privacy mode off, the bot sees every message in a group chat,
      // not just ones meant for it — only DMs can assume every message is
      // addressed to the bot, so only reply with the fallback there.
      if (ctx.chat.type === "private") {
        await ctx.reply("Not sure what you mean — try /help");
      }
      return;
    }
    const resolved = requireCaller(userId);
    if (resolved.status !== "ok") {
      wizards.cancel(userId);
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

    if (state.step === "awaiting_assignee") {
      const username = text.replace(/^@/, "");
      if (!roster.isIntern(username, caller.cohortId)) {
        await ctx.reply(
          `@${username} isn't a known intern in this cohort. Try again, or /cancel.`,
        );
        return;
      }
      wizards.update(userId, {
        step: "awaiting_title",
        data: { assigneeUsername: username },
      });
      await ctx.reply("Title?");
      return;
    }

    if (state.step === "awaiting_title") {
      if (state.kind === "edit" && text === "-") {
        wizards.update(userId, { step: "awaiting_description" });
        await ctx.reply('Description, or "-" to keep it as-is:');
        return;
      }
      if (text.length === 0) {
        await ctx.reply("Title can't be empty. Try again, or /cancel.");
        return;
      }
      wizards.update(userId, {
        step: "awaiting_description",
        data: { title: text },
      });
      await ctx.reply(
        state.kind === "edit" ? 'Description, or "-" to keep it as-is:' : "Description?",
      );
      return;
    }

    if (state.step === "awaiting_description") {
      if (state.kind === "edit" && text === "-") {
        wizards.update(userId, { step: "awaiting_due_date" });
        await ctx.reply(
          'Due date (e.g. "next Friday", "in 3 days", "Sept 5"), or "-" to keep it as-is:',
        );
        return;
      }
      if (text.length === 0) {
        await ctx.reply("Description can't be empty. Try again, or /cancel.");
        return;
      }
      wizards.update(userId, {
        step: "awaiting_due_date",
        data: { description: text },
      });
      await ctx.reply(
        state.kind === "edit"
          ? 'Due date (e.g. "next Friday", "in 3 days", "Sept 5"), or "-" to keep it as-is:'
          : 'Due date? (e.g. "next Friday", "in 3 days", "Sept 5")',
      );
      return;
    }

    if (state.step === "awaiting_due_date") {
      if (state.kind === "edit" && text === "-") {
        await finishWizard(ctx, caller, userId, wizards.get(userId)!);
        return;
      }
      const parsed = parseDueDate(text, new Date());
      if (!parsed) {
        await ctx.reply(
          "I couldn't understand that date. Try phrases like \"next Friday\", \"in 3 days\", or \"Sept 5\", or /cancel.",
        );
        return;
      }
      wizards.update(userId, {
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
    const state = wizards.get(userId);
    if (!state || state.step !== "awaiting_due_date_confirm") {
      await ctx.answerCallbackQuery({ text: "That form has expired." });
      return;
    }
    const resolved = requireCaller(userId);
    if (resolved.status !== "ok") {
      await ctx.answerCallbackQuery({ text: "Send /start first." });
      return;
    }
    const [, decision] = ctx.match as unknown as [string, string];
    await ctx.answerCallbackQuery();

    if (decision === "no") {
      wizards.update(userId, { step: "awaiting_due_date" });
      await ctx.editMessageText(
        'Okay — send the due date again (e.g. "next Friday", "in 3 days", "Sept 5"):',
      );
      return;
    }

    const finalState = wizards.update(userId, {
      data: { dueDate: state.data.pendingDueDate!.isoDate },
    })!;
    await ctx.editMessageText(`Saved: ${state.data.pendingDueDate!.friendly}`);
    await finishWizard(ctx, resolved.caller, userId, finalState);
  });

  async function finishWizard(
    ctx: import("grammy").Context,
    caller: Caller,
    userId: number,
    state: WizardState,
  ) {
    wizards.cancel(userId);

    if (state.kind === "assign") {
      const result = service.assignTask(caller, {
        assigneeUsername: state.data.assigneeUsername!,
        title: state.data.title!,
        description: state.data.description!,
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

    const result = service.editTask(caller, state.data.taskId!, patch);
    if (!result.ok) {
      await ctx.reply(`Couldn't save the edit: ${result.error}`);
      return;
    }
    await ctx.reply(`Task ${state.data.taskId} updated.`);
  }

  return { bot, db, service, roster, registrations };
}

type CommandMatch = string | RegExpMatchArray | undefined;

function matchToString(match: CommandMatch): string {
  if (match === undefined) return "";
  return typeof match === "string" ? match : (match[0] ?? "");
}

function parseIdArg(match: CommandMatch): number | undefined {
  const trimmed = matchToString(match).trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
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
