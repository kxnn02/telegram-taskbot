import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot, type Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { Roster } from "../domain/roster.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryRosterStore } from "../storage/inMemoryRosterStore.js";
import { InMemoryCertTipHistoryStore } from "../storage/inMemoryCertTipHistoryStore.js";
import { FakeTextModel, ThrowingTextModel, type TextModel } from "../nlp/textModel.js";
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

// Defaults to a model that always throws: every parser call site degrades
// to its heuristic path on a model error (issue #102), so tests that don't
// care about the bulk-paste path (issue #104) never need to queue a
// response, and one that unexpectedly hit the model would fail loudly
// instead of hanging.
function makeTestBot(
  roster: Roster,
  activeCohortId: string = COHORT,
  model: TextModel = new ThrowingTextModel(),
) {
  const { calls, transformer } = makeFakeTransformer();
  const bot = new Bot("TEST_TOKEN", { botInfo: FAKE_BOT_INFO });
  bot.api.config.use(transformer);
  const created = createBot({
    token: "TEST_TOKEN",
    taskStore: new InMemoryTaskStore(),
    registrationStore: new InMemoryRegistrationStore(),
    rosterStore: new InMemoryRosterStore(),
    certTipHistoryStore: new InMemoryCertTipHistoryStore(),
    activeCohortId,
    bot,
    roster,
    model,
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

/** A group-chat message, for the mention-trigger paths that are meant to
 * fire in group chatter (issue #34/#103) rather than only in DMs. */
function groupMessageUpdate(
  userId: number,
  username: string,
  chatId: number,
  text: string,
): Update {
  return {
    update_id: updateIdSeq++,
    message: {
      message_id: messageIdSeq++,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "group", title: "Cohort chat" },
      from: { id: userId, is_bot: false, first_name: "Test", username },
      text,
    },
  } as Update;
}

let callbackIdSeq = 1;

/** An inline-button press. `chatId` and the carried `message_id` are what
 * `editMessageText` edits in place (issue #103 items 1 and 3). */
function callbackUpdate(
  userId: number,
  username: string,
  chatId: number,
  data: string,
  messageId = 500,
): Update {
  return {
    update_id: updateIdSeq++,
    callback_query: {
      id: String(callbackIdSeq++),
      from: { id: userId, is_bot: false, first_name: "Test", username },
      chat_instance: "1",
      data,
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private", first_name: "Test" },
        from: FAKE_BOT_INFO,
        text: "previous page",
      },
    },
  } as Update;
}

function lastCall(calls: RecordedCall[], method: string): RecordedCall | undefined {
  return [...calls].reverse().find((c) => c.method === method);
}

interface RecordedKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

function keyboardOf(call: RecordedCall | undefined): RecordedKeyboard {
  return (call?.payload.reply_markup ?? { inline_keyboard: [] }) as RecordedKeyboard;
}

function lastReplyText(calls: RecordedCall[]): string {
  const call = [...calls].reverse().find(
    (c) => c.method === "sendMessage" || c.method === "editMessageText",
  );
  return (call?.payload.text as string) ?? "";
}

/** Like `lastReplyText`, but scoped to messages sent into `chatId` — needed
 * whenever a status-change reply and its (separately-addressed) DM
 * notification could otherwise both land in `calls` and the notification,
 * being later, would win a plain `lastReplyText`. */
function lastReplyTextIn(calls: RecordedCall[], chatId: number): string {
  return lastReplyText(calls.filter((c) => Number(c.payload.chat_id) === chatId));
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

describe("/start (issue #124 stage S3: a pure alias for /help)", () => {
  it("registers the sender and sends byte-identical output to /help — no role question, no hello, no group check", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "newbie", userId, "/start"));

    const text = lastReplyText(testBot.calls);
    const { formatHelp } = await import("./format.js");
    expect(text).toBe(formatHelp("TestBot"));
    expect(text.toLowerCase()).not.toContain("intern");
    expect(text.toLowerCase()).not.toContain("higher-up");
    expect(await testBot.registrations.findUsername(userId)).toBe("newbie");
    expect(roster.isMember("newbie", COHORT)).toBe(true);

    const call = lastCall(testBot.calls, "sendMessage")!;
    expect(call.payload.parse_mode).toBe("HTML");
  });

  it("asks for a username when the sender has none set", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(noUsernameMessageUpdate(userId, userId, "/start"));

    expect(lastReplyText(testBot.calls).toLowerCase()).toContain("username");
  });
});

describe("/help (issue #124 stage S3: Devie's HTML card)", () => {
  it("sends formatHelp()'s exact text with parse_mode HTML", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/help"));

    const { formatHelp } = await import("./format.js");
    const call = lastCall(testBot.calls, "sendMessage")!;
    expect(call.payload.text).toBe(formatHelp("TestBot"));
    expect(call.payload.parse_mode).toBe("HTML");
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
    expect(text).toContain("Task added");
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
    expect(lastReplyTextIn(testBot.calls, bobId)).toContain("Moved to In Review.");

    await testBot.bot.handleUpdate(messageUpdate(bobId, "bob", bobId, `/complete ${taskId}`));
    expect(lastReplyTextIn(testBot.calls, bobId)).toContain("Marked as done. Nice work!");

    await testBot.bot.handleUpdate(messageUpdate(bobId, "bob", bobId, `/update ${taskId} todo`));
    expect(lastReplyTextIn(testBot.calls, bobId)).toContain("Updated to: <b>todo</b>");

    const completedId = nextUserId();
    await testBot.bot.handleUpdate(messageUpdate(completedId, "carol", completedId, `/completed ${taskId}`));
    expect(lastReplyTextIn(testBot.calls, completedId)).toContain("Marked as done. Nice work!");
  });
});

describe("/addtask bare command (no wizard, #106, Devie's block per issue #124 stage S3)", () => {
  it("replies with Devie's usage block instead of starting a step-by-step form", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/addtask"));

    const { ADDTASK_USAGE } = await import("./addTaskParse.js");
    const call = lastCall(testBot.calls, "sendMessage")!;
    const text = call.payload.text as string;
    expect(text).toMatch(/^Usage: <code>\/addtask/);
    expect(text.toLowerCase()).not.toContain("who is this task for");
    expect(text.toLowerCase()).not.toContain("step-by-step");
    expect(text).toBe(ADDTASK_USAGE);
    expect(call.payload.parse_mode).toBe("HTML");
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

  it("sends Devie's exact unknown-command wording with parse_mode HTML (issue #124 stage S3)", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/roster"));

    const call = lastCall(testBot.calls, "sendMessage")!;
    expect(call.payload.text).toBe("❓ Unknown command. Try /help to see what's available.");
    expect(call.payload.parse_mode).toBe("HTML");
  });
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

describe("paged /tasks (issue #103 items 1 and 2)", () => {
  async function seedFor(
    testBot: ReturnType<typeof makeTestBot>,
    assignee: string,
    title: string,
  ) {
    const created = await testBot.service.assignTask(
      { username: "alice", cohortId: COHORT },
      { assigneeUsername: assignee, title, dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed: " + created.error);
    return created.value.id;
  }

  function threeMemberBot() {
    const roster = new Roster([
      { username: "alice", cohortId: COHORT },
      { username: "bob", cohortId: COHORT },
      { username: "carla", cohortId: COHORT },
    ]);
    return makeTestBot(roster);
  }

  it("sends the first page as HTML with a filter row and a nav row", async () => {
    const testBot = threeMemberBot();
    await seedFor(testBot, "alice", "Alice's task");
    await seedFor(testBot, "bob", "Bob's task");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/tasks"));

    const call = lastCall(testBot.calls, "sendMessage")!;
    expect(call.payload.parse_mode).toBe("HTML");
    expect(call.payload.text).toContain("📋 <b>Tasks</b>");
    expect(call.payload.text).toContain("👤 <b>@alice</b>");
    expect(call.payload.text).toContain("<i>(1 / 2)</i>");

    const keyboard = keyboardOf(call);
    expect(keyboard.inline_keyboard[0]).toEqual([
      { text: "· All", callback_data: "tasks|all|0" },
      { text: COHORT, callback_data: `tasks|${COHORT}|0` },
    ]);
    expect(keyboard.inline_keyboard[1]).toEqual([
      { text: "◀ Prev", callback_data: "tasks|all|1" },
      { text: "1 / 2", callback_data: "tasks|all|0" },
      { text: "Next ▶", callback_data: "tasks|all|1" },
    ]);
  });

  it("a Next press edits the same message in place instead of sending a new one", async () => {
    const testBot = threeMemberBot();
    await seedFor(testBot, "alice", "Alice's task");
    await seedFor(testBot, "bob", "Bob's task");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      callbackUpdate(userId, "alice", userId, "tasks|all|1", 777),
    );

    const edit = lastCall(testBot.calls, "editMessageText")!;
    expect(edit.payload.message_id).toBe(777);
    expect(edit.payload.parse_mode).toBe("HTML");
    expect(edit.payload.text).toContain("👤 <b>@bob</b>");
    expect(edit.payload.text).toContain("<i>(2 / 2)</i>");
    expect(lastCall(testBot.calls, "sendMessage")).toBeUndefined();
  });

  it("always answers the callback query so the button stops spinning", async () => {
    const testBot = threeMemberBot();
    await seedFor(testBot, "alice", "Alice's task");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(callbackUpdate(userId, "alice", userId, "tasks|all|0"));

    expect(lastCall(testBot.calls, "answerCallbackQuery")).toBeDefined();
  });

  it("a filter press switches to that role filter and back to page 0", async () => {
    const testBot = threeMemberBot();
    await seedFor(testBot, "alice", "Alice's task");
    await seedFor(testBot, "bob", "Bob's task");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      callbackUpdate(userId, "alice", userId, `tasks|${COHORT}|0`),
    );

    const edit = lastCall(testBot.calls, "editMessageText")!;
    expect(edit.payload.text).toContain(`📋 <b>Tasks — ${COHORT}</b>`);
    expect(keyboardOf(edit).inline_keyboard[0]).toEqual([
      { text: "All", callback_data: "tasks|all|0" },
      { text: `· ${COHORT}`, callback_data: `tasks|${COHORT}|0` },
    ]);
  });

  it("anyone may press a button on someone else's list — no permission check (#103 rule 3)", async () => {
    const testBot = threeMemberBot();
    await seedFor(testBot, "alice", "Alice's task");
    await seedFor(testBot, "bob", "Bob's task");
    const strangerId = nextUserId();

    await testBot.bot.handleUpdate(
      callbackUpdate(strangerId, "stranger", -100, "tasks|all|1"),
    );

    const edit = lastCall(testBot.calls, "editMessageText")!;
    expect(edit.payload.text).toContain("👤 <b>@bob</b>");
    expect(allReplyTexts(testBot.calls).join("")).not.toMatch(/permission|not allowed/i);
  });

  it("/tasks @username filters to that member", async () => {
    const testBot = threeMemberBot();
    await seedFor(testBot, "alice", "Alice's task");
    await seedFor(testBot, "bob", "Bob's task");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/tasks @bob"));

    const text = lastCall(testBot.calls, "sendMessage")!.payload.text as string;
    expect(text).toContain("👤 <b>@bob</b>");
    expect(text).toContain("<i>(1 / 1)</i>");
    expect(text).not.toContain("Alice&#39;s task");
    expect(text).not.toContain("Alice's task");
  });

  it("/tasks <role> maps onto cohort_id, and an unknown role matches nothing", async () => {
    const testBot = threeMemberBot();
    await seedFor(testBot, "alice", "Alice's task");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, `/tasks ${COHORT}`));
    expect(lastCall(testBot.calls, "sendMessage")!.payload.text).toContain("👤 <b>@alice</b>");

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/tasks cohort-9"));
    expect(lastCall(testBot.calls, "sendMessage")!.payload.text).toBe(
      "📋 <b>Tasks — cohort-9</b>\n\n<i>No active tasks for this filter.</i>",
    );
  });

  it("cohort isolation: a callback cannot page into another cohort's tasks", async () => {
    const roster = new Roster([
      { username: "alice", cohortId: COHORT },
      { username: "other", cohortId: "cohort-9" },
    ]);
    const testBot = makeTestBot(roster, COHORT);
    await testBot.service.assignTask(
      { username: "other", cohortId: "cohort-9" },
      { assigneeUsername: "other", title: "Secret task", dueDate: "2026-09-10" },
    );
    const userId = nextUserId();

    await testBot.bot.handleUpdate(callbackUpdate(userId, "alice", userId, "tasks|all|0"));
    await testBot.bot.handleUpdate(callbackUpdate(userId, "alice", userId, "tasks|cohort-9|0"));

    expect(allReplyTexts(testBot.calls).join("")).not.toContain("Secret task");
  });

  it("ignores a malformed tasks callback but still answers it", async () => {
    const testBot = threeMemberBot();
    const userId = nextUserId();

    await testBot.bot.handleUpdate(callbackUpdate(userId, "alice", userId, "tasks|all|nope"));

    expect(lastCall(testBot.calls, "editMessageText")).toBeUndefined();
    expect(lastCall(testBot.calls, "answerCallbackQuery")).toBeDefined();
  });
});

describe("standup filters (issue #103 item 3)", () => {
  it("/standup sends the overview with Devie's five filter buttons", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/standup"));

    const call = lastCall(testBot.calls, "sendMessage")!;
    // #165 S3: the message body is now the person-first summary line, not
    // a "📊 Overview" count block — that label survives only as the first
    // filter button's text, asserted via the keyboard below.
    expect(call.payload.text).toContain("⚠️ 0 overdue · 🔄 0 doing · 👀 0 for approval");
    expect(keyboardOf(call).inline_keyboard[0]!.map((b) => b.callback_data)).toEqual([
      "standup|overview|0",
      "standup|active|0",
      "standup|backlog|0",
      "standup|review|0",
      "standup|done|0",
    ]);
  });

  it("/standup's cert tip is randomized and never repeats immediately for the same cohort", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/standup"));
    const firstText = lastCall(testBot.calls, "sendMessage")!.payload.text as string;
    const firstTipLine = firstText.split("🎓 CCA-F Cert Tip")[1];

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/standup"));
    const secondText = lastCall(testBot.calls, "sendMessage")!.payload.text as string;
    const secondTipLine = secondText.split("🎓 CCA-F Cert Tip")[1];

    expect(secondTipLine).not.toEqual(firstTipLine);
  });

  it("/standup chunks a card over Telegram's limit into multiple ordered sendMessage calls, with the keyboard only on the last (issue #179)", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const caller = { username: "alice", cohortId: COHORT };
    for (let i = 0; i < 100; i++) {
      const created = await testBot.service.assignTask(caller, {
        assigneeUsername: "alice",
        title: `A fairly long task title for entry number ${i} so the card grows large`,
        dueDate: "2026-09-10",
      });
      if (!created.ok) throw new Error("setup failed");
    }
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/standup"));

    const sendCalls = testBot.calls.filter((c) => c.method === "sendMessage");
    expect(sendCalls.length).toBeGreaterThan(1);
    for (const call of sendCalls) {
      const text = call.payload.text as string;
      expect(text.length).toBeLessThanOrEqual(4000);
    }
    // The keyboard is one card's controls, not a per-chunk feature: only
    // the last chunk should carry it.
    for (const call of sendCalls.slice(0, -1)) {
      expect(call.payload.reply_markup).toBeUndefined();
    }
    expect(sendCalls[sendCalls.length - 1]!.payload.reply_markup).toBeDefined();
  });

  it("a filter press edits the standup in place", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const created = await testBot.service.assignTask(
      { username: "alice", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Parked idea", dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed");
    await testBot.service.setStatus(
      { username: "alice", cohortId: COHORT },
      created.value.id,
      "backlog",
    );
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      callbackUpdate(userId, "alice", userId, "standup|backlog|0", 888),
    );

    const edit = lastCall(testBot.calls, "editMessageText")!;
    expect(edit.payload.message_id).toBe(888);
    expect(edit.payload.text).toContain("📦 Backlog (1)");
    expect(edit.payload.text).toContain("Parked idea");
    expect(keyboardOf(edit).inline_keyboard[0]!.map((b) => b.text)).toContain("· Backlog (1)");
  });

  it("ignores an unknown standup filter but still answers the callback", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(callbackUpdate(userId, "alice", userId, "standup|nope|0"));

    expect(lastCall(testBot.calls, "editMessageText")).toBeUndefined();
    expect(lastCall(testBot.calls, "answerCallbackQuery")).toBeDefined();
  });

  it("cohort isolation: a standup filter shows nothing from another cohort", async () => {
    const roster = new Roster([
      { username: "alice", cohortId: COHORT },
      { username: "other", cohortId: "cohort-9" },
    ]);
    const testBot = makeTestBot(roster, COHORT);
    await testBot.service.assignTask(
      { username: "other", cohortId: "cohort-9" },
      { assigneeUsername: "other", title: "Secret task", dueDate: "2026-09-10" },
    );
    const userId = nextUserId();

    for (const filter of ["overview", "active", "backlog", "review", "done"]) {
      await testBot.bot.handleUpdate(
        callbackUpdate(userId, "alice", userId, `standup|${filter}|0`),
      );
    }

    expect(allReplyTexts(testBot.calls).join("")).not.toContain("Secret task");
  });
});

describe("/update's link: and note: riders (issue #103 item 6)", () => {
  async function seedTask(testBot: ReturnType<typeof makeTestBot>, title: string) {
    const created = await testBot.service.assignTask(
      { username: "alice", cohortId: COHORT },
      { assigneeUsername: "alice", title, dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed");
    return created.value.id;
  }

  it("attaches both a link and a note, and echoes them back on the reply", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const id = await seedTask(testBot, "Fix the login bug");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(
        userId,
        "alice",
        userId,
        `/update ${id} done link:https://example.com/pr/1 note: ready for QA`,
      ),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("🔗 https://example.com/pr/1");
    expect(text).toContain("📝 ready for QA");

    const task = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, id);
    if (!task.ok) throw new Error("read failed");
    expect(task.value.status).toBe("done");
    expect(task.value.notes.map((n) => n.text)).toEqual([
      "https://example.com/pr/1",
      "ready for QA",
    ]);
  });

  it("attaches a note on its own", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const id = await seedTask(testBot, "Fix the login bug");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/update ${id} review note: needs a second pair of eyes`),
    );

    expect(lastReplyText(testBot.calls)).toContain("📝 needs a second pair of eyes");
    const task = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, id);
    if (!task.ok) throw new Error("read failed");
    expect(task.value.notes.map((n) => n.text)).toEqual(["needs a second pair of eyes"]);
  });

  it("attaches a link on its own", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const id = await seedTask(testBot, "Fix the login bug");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/update ${id} done link:https://example.com/pr/9`),
    );

    expect(lastReplyText(testBot.calls)).toContain("🔗 https://example.com/pr/9");
    const task = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, id);
    if (!task.ok) throw new Error("read failed");
    expect(task.value.notes.map((n) => n.text)).toEqual(["https://example.com/pr/9"]);
  });

  it("carries a per-item note through a mixed-status batch", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const first = await seedTask(testBot, "Fix the login bug");
    const second = await seedTask(testBot, "Write the docs");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(
        userId,
        "alice",
        userId,
        `/update t${first} done note: shipped, t${second} review`,
      ),
    );

    const text = allReplyTexts(testBot.calls).join("\n");
    expect(text).toContain("📝 shipped");

    const firstTask = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, first);
    const secondTask = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, second);
    if (!firstTask.ok || !secondTask.ok) throw new Error("read failed");
    expect(firstTask.value.notes.map((n) => n.text)).toEqual(["shipped"]);
    expect(secondTask.value.notes).toEqual([]);
  });

  it("a plain /update with no riders attaches nothing", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const id = await seedTask(testBot, "Fix the login bug");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, `/update ${id} done`));

    const text = lastReplyText(testBot.calls);
    expect(text).not.toContain("🔗");
    expect(text).not.toContain("📝");
    const task = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, id);
    if (!task.ok) throw new Error("read failed");
    expect(task.value.notes).toEqual([]);
  });

  it("cohort isolation: a rider cannot be attached to another cohort's task", async () => {
    const roster = new Roster([
      { username: "alice", cohortId: COHORT },
      { username: "other", cohortId: "cohort-9" },
    ]);
    const testBot = makeTestBot(roster, COHORT);
    const foreign = await testBot.service.assignTask(
      { username: "other", cohortId: "cohort-9" },
      { assigneeUsername: "other", title: "Secret task", dueDate: "2026-09-10" },
    );
    if (!foreign.ok) throw new Error("setup failed");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(
        userId,
        "alice",
        userId,
        `/update ${foreign.value.id} done link:https://example.com/leak note: leak`,
      ),
    );

    const task = await testBot.service.getTask(
      { username: "other", cohortId: "cohort-9" },
      foreign.value.id,
    );
    if (!task.ok) throw new Error("read failed");
    expect(task.value.notes).toEqual([]);
    expect(task.value.status).not.toBe("done");
  });
});

describe("keyword task lookup for /done, /complete, /update (issue #124 stage S1)", () => {
  async function seedTask(testBot: ReturnType<typeof makeTestBot>, title: string) {
    const created = await testBot.service.assignTask(
      { username: "alice", cohortId: COHORT },
      { assigneeUsername: "alice", title, dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed");
    return created.value.id;
  }

  it("/done <keyword> moves the matching task to in_review", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const id = await seedTask(testBot, "Fix the login bug");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/done login bug"));

    expect(lastReplyText(testBot.calls)).toContain("Moved to In Review.");
    const task = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, id);
    if (!task.ok) throw new Error("read failed");
    expect(task.value.status).toBe("in_review");
  });

  it("/complete <keyword> marks the matching task done", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const id = await seedTask(testBot, "Write the onboarding doc");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/complete onboarding"));

    expect(lastReplyText(testBot.calls)).toContain("Marked as done. Nice work!");
    const task = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, id);
    if (!task.ok) throw new Error("read failed");
    expect(task.value.status).toBe("done");
  });

  it("/update <keyword> <status> resolves by title", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const id = await seedTask(testBot, "Fix the login bug");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/update login bug blocked"));

    expect(lastReplyText(testBot.calls)).toContain("Updated to: <b>blocked</b>");
    const task = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, id);
    if (!task.ok) throw new Error("read failed");
    expect(task.value.status).toBe("blocked");
  });

  it("an ambiguous keyword lists candidates via /done and mutates no task", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const first = await seedTask(testBot, "Fix the login page");
    const second = await seedTask(testBot, "Redesign the login page");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/done login page"));

    const reply = lastReplyText(testBot.calls);
    expect(reply).toContain("Multiple tasks matched");
    expect(reply).toContain("/done &lt;number&gt;");
    const firstTask = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, first);
    const secondTask = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, second);
    if (!firstTask.ok || !secondTask.ok) throw new Error("read failed");
    expect(firstTask.value.status).not.toBe("in_review");
    expect(secondTask.value.status).not.toBe("in_review");
  });

  it("a numeric miss replies 'no active task found' and never falls through to keyword search", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    await seedTask(testBot, "999");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/done 999"));

    expect(lastReplyText(testBot.calls)).toContain("No active task found");
  });

  it("/done t21,t22 (comma bulk) still works", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const first = await seedTask(testBot, "First task");
    const second = await seedTask(testBot, "Second task");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/done t${first},t${second}`),
    );

    const firstTask = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, first);
    const secondTask = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, second);
    if (!firstTask.ok || !secondTask.ok) throw new Error("read failed");
    expect(firstTask.value.status).toBe("in_review");
    expect(secondTask.value.status).toBe("in_review");
  });

  it("/done t21\\nt22 (newline bulk) now works", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const first = await seedTask(testBot, "First task");
    const second = await seedTask(testBot, "Second task");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/done t${first}\nt${second}`),
    );

    const firstTask = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, first);
    const secondTask = await testBot.service.getTask({ username: "alice", cohortId: COHORT }, second);
    if (!firstTask.ok || !secondTask.ok) throw new Error("read failed");
    expect(firstTask.value.status).toBe("in_review");
    expect(secondTask.value.status).toBe("in_review");
  });
});

describe("Devie's batch reply shape (issue #124 stage S3)", () => {
  async function seedTask(testBot: ReturnType<typeof makeTestBot>, title: string) {
    const created = await testBot.service.assignTask(
      { username: "alice", cohortId: COHORT },
      { assigneeUsername: "alice", title, dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed");
    return created.value.id;
  }

  it("a mixed success/failure /done batch groups failures under a Skipped header, HTML", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const id = await seedTask(testBot, "Fix the login bug");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/done t${id},t999`),
    );

    const call = lastCall(testBot.calls, "sendMessage")!;
    expect(call.payload.parse_mode).toBe("HTML");
    const text = call.payload.text as string;
    expect(text).toContain("👀 <b>Moved 1 task to In Review.</b>");
    expect(text).toContain(`<code>T-${String(id).padStart(3, "0")}</code> Fix the login bug → <b>in review</b>`);
    expect(text).toContain("⚠️ <b>Skipped 1 item:</b>");
    expect(text).toContain("t999");
  });

  it("an all-failed /complete batch renders the dedicated no-tasks-updated block, not usage text", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "/complete t998,t999"),
    );

    const call = lastCall(testBot.calls, "sendMessage")!;
    expect(call.payload.parse_mode).toBe("HTML");
    const text = call.payload.text as string;
    expect(text).toContain("❌ No tasks were updated.");
    expect(text).toContain("<i>Use /tasks to see valid task numbers.</i>");
    expect(text).not.toMatch(/^Usage:/);
  });

  it("an /update batch's link:/note: riders render as indented sub-lines", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const first = await seedTask(testBot, "Fix the login bug");
    const second = await seedTask(testBot, "Write the docs");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(
        userId,
        "alice",
        userId,
        `/update t${first} done link:https://example.com/pr/1, t${second} done`,
      ),
    );

    const call = lastCall(testBot.calls, "sendMessage")!;
    const text = call.payload.text as string;
    expect(text).toContain("✅ <b>Updated 2 tasks.</b>");
    expect(text).toContain("  🔗 https://example.com/pr/1");
  });

  it("single-item /done, /complete and /update replies are all sent with parse_mode HTML", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    const id1 = await seedTask(testBot, "Task one");
    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, `/done ${id1}`));
    expect(lastCall(testBot.calls, "sendMessage")!.payload.parse_mode).toBe("HTML");

    const id2 = await seedTask(testBot, "Task two");
    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, `/complete ${id2}`));
    expect(lastCall(testBot.calls, "sendMessage")!.payload.parse_mode).toBe("HTML");

    const id3 = await seedTask(testBot, "Task three");
    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, `/update ${id3} todo`));
    expect(lastCall(testBot.calls, "sendMessage")!.payload.parse_mode).toBe("HTML");
  });
});

describe("trailing /addtask entry point (issue #103 item 4)", () => {
  it("a message whose final line is exactly /addtask creates a task from the text above it", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "Fix the login bug\n/addtask"),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Task added");
    const tasks = await testBot.service.listAllTasks({ username: "alice", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value.map((t) => t.title)).toEqual(["Fix the login bug"]);
  });

  it("works in a group chat too, not just a DM", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "Ship the release notes\n/addtask"),
    );

    expect(lastReplyText(testBot.calls)).toContain("Task added");
  });

  it("does NOT route when /addtask is the last token on a line with text before it", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "Fix the login bug /addtask"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "alice", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value).toEqual([]);
    expect(lastReplyText(testBot.calls)).not.toContain("created");
  });

  it("does NOT route when /addtask sits mid-text", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "Fix the login bug\n/addtask\nand the signup one"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "alice", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value).toEqual([]);
  });

  it("does NOT route when the message starts with one of the ten commands", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/tasks\n/addtask"));

    const tasks = await testBot.service.listAllTasks({ username: "alice", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value).toEqual([]);
  });

  it("a bare /addtask still gets the existing usage reply", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/addtask"));

    expect(lastReplyText(testBot.calls)).toMatch(/^Usage: <code>\/addtask/);
  });

  it("carries the assignee and date grammar through, same as /addtask", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const bobId = nextUserId();
    await testBot.bot.handleUpdate(messageUpdate(bobId, "bob", bobId, "/help"));
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "Fix the login bug @bob\n/addtask"),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("@bob");
  });

  it("cohort isolation: the created task lands only in the caller's cohort", async () => {
    const roster = new Roster([{ username: "other", cohortId: "cohort-9" }]);
    const testBot = makeTestBot(roster, "cohort-5");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "Trailing-scoped task\n/addtask"),
    );

    const otherCohort = await testBot.service.listAllTasks({
      username: "other",
      cohortId: "cohort-9",
    });
    if (!otherCohort.ok) throw new Error("read failed");
    expect(otherCohort.value).toEqual([]);
  });
});

describe("mention trigger (issue #34, widened by #103)", () => {
  it("a newly accepted phrase creates a task from a group message", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "@test_bot work on fix the login bug"),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Task added");
    expect(text).toContain("@alice");
  });

  it("'create task ...' and 'add task: ...' both route", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "@test_bot create task write the docs"),
    );
    expect(lastReplyText(testBot.calls)).toContain("Task added");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "@test_bot add task: ship the release"),
    );
    expect(lastReplyText(testBot.calls)).toContain("Task added");
  });

  it("'todo ...' no longer routes and produces no reply — Devie never accepted it (#103)", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "@test_bot todo fix the login bug"),
    );

    expect(allReplyTexts(testBot.calls)).toEqual([]);
  });

  it("a passing mention like 'thanks @bot' produces NO reply at all, not a 'did you mean' nudge", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "thanks @test_bot !"),
    );

    expect(allReplyTexts(testBot.calls)).toEqual([]);
  });

  it("a leading mention with no phrase match is silent too (#103 makes this silent)", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "@test_bot how's it going"),
    );

    expect(allReplyTexts(testBot.calls)).toEqual([]);
    expect(allReplyTexts(testBot.calls).join("")).not.toContain("Did you mean");
  });

  it("a phrase with no title left behind gets /addtask's usage example", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "@test_bot add task"),
    );

    expect(lastReplyText(testBot.calls)).toMatch(/^Usage: <code>\/addtask/);
  });

  it("cohort isolation: a mention-created task lands in the caller's own cohort only", async () => {
    const roster = new Roster([{ username: "other", cohortId: "cohort-9" }]);
    const testBot = makeTestBot(roster, "cohort-5");
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(userId, "alice", -100, "@test_bot add task mention-scoped task"),
    );

    const otherCohort = await testBot.service.listAllTasks({
      username: "other",
      cohortId: "cohort-9",
    });
    if (!otherCohort.ok) throw new Error("read failed");
    expect(otherCohort.value).toEqual([]);

    const ownCohort = await testBot.service.listAllTasks({
      username: "alice",
      cohortId: "cohort-5",
    });
    if (!ownCohort.ok) throw new Error("read failed");
    expect(ownCohort.value.map((t) => t.title)).toEqual(["mention-scoped task"]);
  });
});

// Issue #104: paste-in bulk task capture, wired through /addtask, the
// trailing-/addtask entry point, and the mention trigger — all three share
// `handleAddTaskArgs`, so bulk detection covers all of them at once.
describe("bulk-paste task capture (issue #104)", () => {
  function bulkModel(tasks: Array<Record<string, unknown>>) {
    return new FakeTextModel([JSON.stringify(tasks)]);
  }

  it("creates one task per extracted paragraph, grouped by assignee in the reply", async () => {
    // The caller ("carla") must already be a roster member — auto-
    // registering a never-before-seen caller replaces this in-process
    // roster wholesale from the (empty) roster store, which would wipe out
    // dale/kien below (see resolveCaller's replaceAll).
    const roster = new Roster([
      { username: "carla", cohortId: COHORT },
      { username: "dale", cohortId: COHORT },
      { username: "kien", cohortId: COHORT },
    ]);
    const model = bulkModel([
      { assignee: "dale", title: "Summarize recommendations", priority: "medium", dueDate: null },
      { assignee: "kien", title: "Review the PR", priority: "medium", dueDate: null },
    ]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(
        userId,
        "carla",
        userId,
        "/addtask @dale summarize the recs\n\n@kien review the PR",
      ),
    );

    const call = lastCall(testBot.calls, "sendMessage")!;
    expect(call.payload.parse_mode).toBe("HTML");
    expect(call.payload.text).toContain("<b>2 tasks added.</b>");
    expect(call.payload.text).toContain("@dale");
    expect(call.payload.text).toContain("@kien");

    const tasks = await testBot.service.listAllTasks({ username: "carla", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value.map((t) => t.assigneeUsername).sort()).toEqual(["dale", "kien"]);
  });

  it("creates an orphan task when the parsed assignee matches no roster member (carbon-copy rule)", async () => {
    const roster = new Roster([{ username: "carla", cohortId: COHORT }]);
    const model = bulkModel([
      { assignee: "notarealperson", title: "Mystery task", priority: "medium", dueDate: null },
    ]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(
        userId,
        "carla",
        userId,
        "/addtask @notarealperson do the mystery thing\n\nsecond line",
      ),
    );

    const tasks = await testBot.service.listAllTasks({ username: "carla", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value.map((t) => t.assigneeUsername)).toEqual(["notarealperson"]);
  });

  it("falls back to the message author when the parser found no @mention at all", async () => {
    const roster = new Roster([{ username: "carla", cohortId: COHORT }]);
    const model = bulkModel([
      { assignee: "unassigned", title: "First bullet", priority: "medium", dueDate: null },
      { assignee: "unassigned", title: "Second bullet", priority: "medium", dueDate: null },
    ]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "carla", userId, "/addtask - First bullet\n\n- Second bullet"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "carla", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value.every((t) => t.assigneeUsername === "carla")).toBe(true);
  });

  it("defaults a task's due date to the nearest onsite Tuesday/Thursday, not comingFriday", async () => {
    // System time is 2026-09-05T02:00:00Z (Saturday, Manila) — see the
    // top-level beforeEach. Nearest onsite day is Tuesday 2026-09-08.
    const roster = new Roster([
      { username: "carla", cohortId: COHORT },
      { username: "dale", cohortId: COHORT },
    ]);
    const model = bulkModel([
      { assignee: "dale", title: "No date given", priority: "medium", dueDate: null },
    ]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "carla", userId, "/addtask @dale no date given\n\nsecond line"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "carla", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value[0]?.dueDate).toBe("2026-09-08");
  });

  it("replies with Devie's no-tasks-extracted message when the parser returns nothing", async () => {
    // An empty model response ([]) alone isn't enough to reach this reply —
    // `parseBulkTasks` falls back to its heuristic parser whenever the
    // model's own extraction comes back empty (issue #102), and that
    // heuristic is resilient enough to find *something* in almost any text.
    // This body is chosen so the heuristic also comes up empty: a single
    // punctuation-only "paragraph" whose title strips down to nothing once
    // trailing `!`/`?` characters are removed (`parseBulkTasksHeuristic`
    // then `continue`s past it) — the semicolon-plus-space is only there to
    // satisfy `shouldTriggerBulkCreate`'s grouped-segment gate.
    const roster = new Roster([]);
    const model = bulkModel([]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "carla", userId, "/addtask !!! ;  ???"),
    );

    expect(lastReplyText(testBot.calls)).toBe(
      "❌ Could not extract any tasks from that message.",
    );
  });

  it("degrades to the heuristic parser when the model throws, and still creates tasks", async () => {
    const roster = new Roster([{ username: "carla", cohortId: COHORT }]);
    const testBot = makeTestBot(roster, COHORT, new ThrowingTextModel());
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "carla", userId, "/addtask @dale fix the bug\n\n@kien review the PR"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "carla", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value.length).toBeGreaterThan(0);
  });

  it("cohort isolation: a bulk paste cannot create tasks in another cohort", async () => {
    const roster = new Roster([
      { username: "carla", cohortId: COHORT },
      { username: "dale", cohortId: COHORT },
      { username: "other", cohortId: "cohort-9" },
    ]);
    const model = bulkModel([
      { assignee: "dale", title: "Cohort-scoped bulk task", priority: "medium", dueDate: null },
    ]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "carla", userId, "/addtask @dale task one\n\nsecond line"),
    );

    const otherCohort = await testBot.service.listAllTasks({
      username: "other",
      cohortId: "cohort-9",
    });
    if (!otherCohort.ok) throw new Error("read failed");
    expect(otherCohort.value).toEqual([]);
  });

  it("an ordinary single-line, single-mention /addtask is unaffected — no bulk detour", async () => {
    const roster = new Roster([
      { username: "carla", cohortId: COHORT },
      { username: "dale", cohortId: COHORT },
    ]);
    const testBot = makeTestBot(roster, COHORT, new ThrowingTextModel());
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "carla", userId, "/addtask fix the login bug @dale"),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Task added");
    expect(text).toContain("👤 Assigned to: @dale");
  });
});

// Issue #126/Parity S2: three parser gaps, all fixed by wiring up code that
// was already ported and tested but unreferenced (`getNextOnsiteDay`'s
// single-task path, `cleanTaskTitle`, `parseStatus`).
describe("Parity S2: onsite default, NL priority, status fallback (issue #126)", () => {
  it("a bare /addtask defaults to the next Tue/Thu onsite day, not comingFriday", async () => {
    // Top-level beforeEach freezes "now" to 2026-09-05T02:00:00Z (Saturday,
    // Manila) — nearest onsite day is Tuesday 2026-09-08.
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "freshuser", userId, "/addtask fix login"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "freshuser", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value[0]?.dueDate).toBe("2026-09-08");
  });

  it("rolls forward to the next onsite day, never the same day, when 'today' is itself Tuesday", async () => {
    vi.setSystemTime(new Date("2026-09-08T02:00:00.000Z")); // Tuesday, Manila
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "freshuser", userId, "/addtask fix login"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "freshuser", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value[0]?.dueDate).toBe("2026-09-10"); // next Thursday
  });

  it("/addtask fix login bug, high priority creates a high task titled 'fix login bug'", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "freshuser", userId, "/addtask fix login bug, high priority"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "freshuser", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value[0]?.title).toBe("fix login bug");
    expect(tasks.value[0]?.priority).toBe("high");
  });

  it("an explicit !priority flag wins over contradictory prose (deliberate gap, issue #126)", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "freshuser", userId, "/addtask fix login bug !low, high priority"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "freshuser", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value[0]?.priority).toBe("low");
  });

  it("an explicit 'by <date>' still wins over the onsite-day default", async () => {
    const roster = new Roster([]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "freshuser", userId, "/addtask fix login by Friday"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "freshuser", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value[0]?.dueDate).toBe("2026-09-11"); // the explicit "by Friday", not onsite Tuesday
  });

  it("a bare trailing 'urgent' with an @mention is pinned to whatever cleanTaskTitle actually does, not guessed at", async () => {
    // Earlier draft of #126 claimed this was a gap; it isn't — parseAddTaskArgs
    // consumes @dale but sets no priority, so cleanTaskTitle's own phrase
    // list decides the outcome. inferPriority has no "urgent"-without-a-
    // priority-word rule beyond its literal keyword list, which does
    // include "urgent" — so this resolves to urgent.
    const roster = new Roster([
      { username: "freshuser", cohortId: COHORT },
      { username: "dale", cohortId: COHORT },
    ]);
    const testBot = makeTestBot(roster);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "freshuser", userId, "/addtask fix login @dale urgent"),
    );

    const tasks = await testBot.service.listAllTasks({ username: "freshuser", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value[0]?.priority).toBe("urgent");
    expect(tasks.value[0]?.title).toBe("fix login");
  });

  it("/update <ref> <unrecognized phrase> falls back to the model, e.g. 'working on it' -> in_progress", async () => {
    const roster = new Roster([]);
    const model = new FakeTextModel(["in_progress"]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();
    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/help"));
    const created = await testBot.service.assignTask(
      { username: "alice", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Some task", dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/update ${created.value.id} working on it`),
    );

    expect(lastReplyText(testBot.calls)).toContain("Updated to: <b>in progress</b>");
    expect(model.requests).toHaveLength(1);
  });

  it("/update <ref> inreview is refused by name with a 'use review' message, and changes nothing", async () => {
    const roster = new Roster([]);
    const model = new FakeTextModel([]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();
    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/help"));
    const created = await testBot.service.assignTask(
      { username: "alice", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Some task", dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/update ${created.value.id} inreview`),
    );

    expect(lastReplyText(testBot.calls)).toContain("invalid status");
    expect(lastReplyText(testBot.calls)).toContain("review");
    expect(model.requests).toHaveLength(0);
    const tasks = await testBot.service.listAllTasks({ username: "alice", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value[0]?.status).not.toBe("in_review");
  });

  it("the model is not called when the alias table already resolves the status", async () => {
    const roster = new Roster([]);
    const model = new FakeTextModel([]);
    const testBot = makeTestBot(roster, COHORT, model);
    const userId = nextUserId();
    await testBot.bot.handleUpdate(messageUpdate(userId, "alice", userId, "/help"));
    const created = await testBot.service.assignTask(
      { username: "alice", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Some task", dueDate: "2026-09-10" },
    );
    if (!created.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/update ${created.value.id} done`),
    );

    expect(lastReplyText(testBot.calls)).toContain("Updated to: <b>done</b>");
    expect(model.requests).toHaveLength(0);
  });
});

// Issue #104: Devie's `@all`/role-slug fan-out for the single-mention
// /addtask grammar. The caller is always one of the roster members already
// seeded below (not a fresh "carla") — auto-registering a never-before-seen
// caller replaces the whole in-process roster from the (empty) roster
// store, wiping out anyone seeded directly (see resolveCaller's
// replaceAll). Devie's "no members found to assign to" branch (route.ts:
// 1207-1209) is carbon-copied in `fanOut.ts` and covered at the unit level
// in `fanOut.test.ts` — it has no honest end-to-end reproduction here,
// since the caller is always auto-registered into their own cohort before
// this handler runs, so `@all` (fanning out across that same cohort) can
// never actually come back empty.
describe("@all and role fan-out (issue #104)", () => {
  it("/addtask <title> @all creates one task per roster member in the caller's cohort", async () => {
    const roster = new Roster([
      { username: "alice", cohortId: COHORT },
      { username: "bob", cohortId: COHORT },
    ]);
    const testBot = makeTestBot(roster, COHORT);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "/addtask Fix the login page @all"),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("✅ Task assigned to all <b>2</b> members");
    expect(text).toContain("Fix the login page");

    const tasks = await testBot.service.listAllTasks({ username: "alice", cohortId: COHORT });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value.map((t) => t.assigneeUsername).sort()).toEqual(["alice", "bob"]);
  });

  // `/addtask`'s mention grammar reuses `MENTION_RE` (`\w+` only — no
  // hyphens), the same restriction Devie's own `@(\w+)` mention capture has.
  // A cohort id with no hyphen (e.g. "cohort5b" below) fans out cleanly; the
  // real deployed cohort id ("cohort-5", see the next test) can't be typed
  // as a mention token at all — not a bug this ticket introduces, since
  // Telegram's own mention syntax has the identical restriction.
  it("/addtask <title> @<cohort-id> fans out to that cohort's roster (role mapped onto cohort_id)", async () => {
    const HYPHEN_FREE_COHORT = "cohort5b";
    const roster = new Roster([
      { username: "alice", cohortId: HYPHEN_FREE_COHORT },
      { username: "bob", cohortId: HYPHEN_FREE_COHORT },
      { username: "erin", cohortId: "cohort-9" },
    ]);
    const testBot = makeTestBot(roster, HYPHEN_FREE_COHORT);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/addtask Fix the login page @${HYPHEN_FREE_COHORT}`),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain(`in <b>${HYPHEN_FREE_COHORT}</b>`);

    const tasks = await testBot.service.listAllTasks({
      username: "alice",
      cohortId: HYPHEN_FREE_COHORT,
    });
    if (!tasks.ok) throw new Error("read failed");
    expect(tasks.value.map((t) => t.assigneeUsername).sort()).toEqual(["alice", "bob"]);
  });

  it("a hyphenated cohort id (the real deployed shape, e.g. 'cohort-5') can't be typed as a mention token at all — falls through to plain single-assignee creation", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster, COHORT);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, `/addtask Fix the login page @${COHORT}`),
    );

    // MENTION_RE's `\w+` stops at the hyphen, and the lookahead then fails
    // (what follows isn't whitespace/end-of-string) — so no mention is
    // recognized at all, and the whole `@cohort-5` stays in the title.
    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Task added");
    expect(text).toContain("👤 Assigned to: @alice");
  });

  it("a role/cohort token matching nobody falls through to the ordinary unknown-member reply", async () => {
    const roster = new Roster([{ username: "alice", cohortId: COHORT }]);
    const testBot = makeTestBot(roster, COHORT);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "/addtask Fix the login page @nonexistentcohort"),
    );

    expect(lastReplyText(testBot.calls)).toContain(
      "don't see @nonexistentcohort on this cohort's roster",
    );
  });

  it("cohort isolation: @all never reaches a member of another cohort", async () => {
    const roster = new Roster([
      { username: "alice", cohortId: COHORT },
      { username: "erin", cohortId: "cohort-9" },
    ]);
    const testBot = makeTestBot(roster, COHORT);
    const userId = nextUserId();

    await testBot.bot.handleUpdate(
      messageUpdate(userId, "alice", userId, "/addtask Fix the login page @all"),
    );

    const otherCohort = await testBot.service.listAllTasks({
      username: "erin",
      cohortId: "cohort-9",
    });
    if (!otherCohort.ok) throw new Error("read failed");
    expect(otherCohort.value).toEqual([]);
  });
});

describe("BOT_COMMANDS / formatHelp coherence", () => {
  it("every command Telegram's autocomplete menu offers, except /start and /help (Devie's own card has no line for either), also appears in /help", async () => {
    const { formatHelp } = await import("./format.js");
    const helpText = formatHelp("TestBot");
    for (const { command } of BOT_COMMANDS) {
      if (command === "start" || command === "help") continue;
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
