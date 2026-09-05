import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot, type Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { Roster } from "../domain/roster.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryRosterStore } from "../storage/inMemoryRosterStore.js";
import { createBot, BOT_COMMANDS, HANDLED_COMMANDS, type CreatedBot } from "./createBot.js";

/**
 * #106/ADR-0013 stripped this bot down to Devie's exact 10-command surface
 * and replaced roster-gated registration with auto-registration. The old
 * suite here (4000+ lines) tested the wizard system, roster gating,
 * /start's role-picking flow, and 12 now-removed commands
 * (cancel/mytasks/task/overdue/pending/blocked/unblock/note/edit/roster/
 * dashboard/whoami plus the redirect handlers for submit/approve/revise/
 * canceltask/unblocked/alltasks/backlog) — all deleted along with the
 * behavior they covered. This file replaces it with coverage for what
 * survives: BOT_COMMANDS' shape, auto-registration, every surviving
 * command working for a brand-new sender, and removed commands getting
 * Telegram's default fallback rather than a stack trace.
 */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-05T02:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const COHORT = "cohort-5";

const FAKE_BOT_INFO: UserFromGetMe = {
  id: 999,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

interface RecordedCall {
  method: string;
  payload: Record<string, unknown>;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;

function makeFakeTransformer() {
  const calls: RecordedCall[] = [];
  let messageId = 1000;
  const transformer: Transformer = async (_prev, method, payload) => {
    calls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
    const p = (payload ?? {}) as Record<string, unknown>;
    if (method === "sendMessage" || method === "editMessageText") {
      const text = (p.text as string) ?? "";
      if (text.length > TELEGRAM_MESSAGE_LIMIT) {
        throw new Error("Bad Request: message is too long");
      }
      return {
        ok: true,
        result: {
          message_id: (p.message_id as number) ?? messageId++,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(p.chat_id) || 1, type: "private" },
          text,
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  };
  return { calls, transformer };
}

let userIdSeq = 1000;
let updateIdSeq = 1;
let messageIdSeq = 1;

function nextUserId() {
  return userIdSeq++;
}

function makeTestBot(roster: Roster, activeCohortId: string = COHORT) {
  const { calls, transformer } = makeFakeTransformer();
  const bot = new Bot("TEST_TOKEN", { botInfo: FAKE_BOT_INFO });
  bot.api.config.use(transformer);
  const created = createBot({
    token: "TEST_TOKEN",
    taskStore: new InMemoryTaskStore(),
    registrationStore: new InMemoryRegistrationStore(),
    rosterStore: new InMemoryRosterStore(),
    activeCohortId,
    dashboardUrl: "http://localhost:1234",
    bot,
    roster,
  });
  return { ...created, calls };
}

/** A message from `username`, who may never have messaged the bot before —
 * auto-registration (ADR-0013) means every command must work without any
 * prior /start. */
function messageUpdate(userId: number, username: string, chatId: number, text: string): Update {
  const entities = text.startsWith("/")
    ? [
        {
          type: "bot_command",
          offset: 0,
          length: (text.match(/^\/\S+/)?.[0] ?? text).length,
        },
      ]
    : undefined;
  return {
    update_id: updateIdSeq++,
    message: {
      message_id: messageIdSeq++,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private" },
      from: { id: userId, is_bot: false, first_name: "Test", username },
      text,
      ...(entities ? { entities } : {}),
    },
  } as Update;
}

function noUsernameMessageUpdate(userId: number, chatId: number, text: string): Update {
  const entities = text.startsWith("/")
    ? [
        {
          type: "bot_command",
          offset: 0,
          length: (text.match(/^\/\S+/)?.[0] ?? text).length,
        },
      ]
    : undefined;
  return {
    update_id: updateIdSeq++,
    message: {
      message_id: messageIdSeq++,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private" },
      from: { id: userId, is_bot: false, first_name: "Test" },
      text,
      ...(entities ? { entities } : {}),
    },
  } as Update;
}

function lastReplyText(calls: RecordedCall[]): string {
  const call = [...calls].reverse().find(
    (c) => c.method === "sendMessage" || c.method === "editMessageText",
  );
  return (call?.payload.text as string) ?? "";
}

function allReplyTexts(calls: RecordedCall[]): string[] {
  return calls
    .filter((c) => c.method === "sendMessage" || c.method === "editMessageText")
    .map((c) => (c.payload.text as string) ?? "");
}

describe("BOT_COMMANDS / HANDLED_COMMANDS", () => {
  it("is exactly Devie's 10-command surface", () => {
    expect(BOT_COMMANDS.map((c) => c.command).sort()).toEqual(
      [
        "start",
        "help",
        "tasks",
        "deadlines",
        "addtask",
        "done",
        "complete",
        "completed",
        "update",
        "standup",
      ].sort(),
    );
  });

  it("has no removed command in HANDLED_COMMANDS", () => {
    for (const removed of [
      "cancel",
      "mytasks",
      "task",
      "overdue",
      "pending",
      "blocked",
      "unblock",
      "note",
      "edit",
      "roster",
      "dashboard",
      "whoami",
      "submit",
      "approve",
      "revise",
      "canceltask",
      "unblocked",
      "alltasks",
      "backlog",
    ]) {
      expect(HANDLED_COMMANDS.has(removed)).toBe(false);
    }
  });
});

describe("/start", () => {
  it("registers the sender and says hello — no role question, no group check", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "newbie", userId, "/start"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("newbie");
    expect(text).toContain(COHORT);
    expect(text.toLowerCase()).not.toContain("intern");
    expect(text.toLowerCase()).not.toContain("higher-up");
    expect(await testBot.registrations.findUsername(userId)).toBe("newbie");
    expect(roster.isMember("newbie", COHORT)).toBe(true);
  });

  it("asks for a username when the sender has none set", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(noUsernameMessageUpdate(userId, userId, "/start"));

    expect(lastReplyText(testBot.calls).toLowerCase()).toContain("username");
  });
});

describe("auto-registration (ADR-0013) — every surviving command works for a never-before-seen sender", () => {
  const commands = [
    "/help",
    "/tasks",
    "/deadlines",
    "/standup",
  ];

  for (const command of commands) {
    it(`${command} works without any prior /start`, async () => {
      const roster = new Roster([]);
      const testBot = makeTestBot(roster);
      const userId = nextUserId();

      await testBot.bot.handleUpdate(messageUpdate(userId, "freshuser", userId, command));

      expect(lastReplyText(testBot.calls)).not.toBe("");
      expect(await testBot.registrations.findUsername(userId)).toBe("freshuser");
    });
  }

  it("/addtask with no prior /start creates a task assigned to the sender", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "freshuser", userId, "/addtask Write the report"),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("created");
    expect(text).toContain("@freshuser");
  });

  it("/done, /complete, /completed, /update all work for a never-before-seen assignee", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    // bob has to have messaged the bot once (auto-registering him) before he
    // can be a valid assignee — same as any other roster member.
    const bobId = nextUserId();
    await testBot.bot.handleUpdate(messageUpdate(bobId, "bob", bobId, "/help"));

    const creatorId = nextUserId();
    await testBot.bot.handleUpdate(
      messageUpdate(creatorId, "creator", creatorId, "/addtask Task for bob @bob"),
    );
    const created = await testBot.service.assignTask(
      { username: "creator", cohortId: COHORT },
      { assigneeUsername: "bob", title: "Second task", dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed");
    const taskId = created.value.id;

    await testBot.bot.handleUpdate(messageUpdate(bobId, "bob", bobId, `/done ${taskId}`));
    expect(lastReplyText(testBot.calls)).toContain("In review");

    await testBot.bot.handleUpdate(messageUpdate(bobId, "bob", bobId, `/complete ${taskId}`));
    expect(lastReplyText(testBot.calls)).toContain("Done");

    await testBot.bot.handleUpdate(messageUpdate(bobId, "bob", bobId, `/update ${taskId} todo`));
    expect(lastReplyText(testBot.calls)).toContain("To do");

    const completedId = nextUserId();
    await testBot.bot.handleUpdate(messageUpdate(completedId, "carol", completedId, `/completed ${taskId}`));
    expect(lastReplyText(testBot.calls)).toContain("Done");
  });
});

describe("/addtask bare command (no wizard, #106)", () => {
  it("replies with a usage example instead of starting a step-by-step form", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/addtask"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/^Usage: \/addtask/);
    expect(text.toLowerCase()).not.toContain("who is this task for");
  });
});

describe("removed commands get Telegram's default unknown-command fallback, not a stack trace", () => {
  const removedCommands = ["/roster", "/edit 1", "/whoami", "/dashboard", "/cancel", "/mytasks", "/note 1 hi", "/task 1"];

  for (const command of removedCommands) {
    it(`${command} does not throw and gets the generic fallback reply in a private chat`, async () => {
      const roster = new Roster([]);
      const testBot = makeTestBot(roster);
      const userId = nextUserId();

      await expect(
        testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, command)),
      ).resolves.not.toThrow();

      const text = lastReplyText(testBot.calls);
      expect(text).not.toBe("");
      expect(allReplyTexts(testBot.calls).some((t) => t.toLowerCase().includes("error"))).toBe(false);
    });
  }
});

describe("cohort isolation survives the strip (the one guarantee that must)", () => {
  it("a member auto-registered in one cohort cannot see another cohort's tasks via /tasks", async () => {
    // Seed a member of a wholly separate cohort so the direct assignTask
    // call below has a valid roster entry to assign against.
    const roster = new Roster([{ username: "other", cohortId: "cohort-9" }]);
    const testBot = makeTestBot(roster, "cohort-5");

    const otherCohortResult = await testBot.service.assignTask(
      { username: "other", cohortId: "cohort-9" },
      { assigneeUsername: "other", title: "Secret task", dueDate: "2026-09-10" },
    );
    expect(otherCohortResult.ok).toBe(true);

    const userId = nextUserId();
    await testBot.bot.handleUpdate(messageUpdate(userId, "member5", userId, "/tasks"));

    const text = lastReplyText(testBot.calls);
    expect(text).not.toContain("Secret task");
  });
});

describe("BOT_COMMANDS / formatHelp coherence", () => {
  it("every command Telegram's autocomplete menu offers also appears in /help", async () => {
    const { formatHelp } = await import("./format.js");
    const helpText = formatHelp();
    for (const { command } of BOT_COMMANDS) {
      expect(helpText).toContain(`/${command}`);
    }
  });
});

describe("registerBotCommands", () => {
  it("registers exactly BOT_COMMANDS with Telegram", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const { registerBotCommands } = await import("./createBot.js");
    await registerBotCommands(testBot.bot);
    const call = testBot.calls.find((c) => c.method === "setMyCommands");
    expect(call?.payload.commands).toEqual(BOT_COMMANDS);
  });
});

describe("CreatedBot shape", () => {
  it("has no wizards field any more (#106 — the wizard system is gone)", () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    expect((testBot as unknown as Record<string, unknown>).wizards).toBeUndefined();
  });
});
