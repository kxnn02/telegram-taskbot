import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot, InlineKeyboard, type Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { Roster } from "../domain/roster.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryWizardStateStore } from "../storage/inMemoryWizardStateStore.js";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import { createBot, type CreatedBot } from "./createBot.js";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-31T02:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const COHORT = "cohort-5";

function makeRoster() {
  return new Roster([
    { username: "carla", role: "HigherUp", cohortId: COHORT },
    { username: "alice", role: "Intern", cohortId: COHORT },
    { username: "bob", role: "Intern", cohortId: COHORT },
  ]);
}

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

// Mirrors the real Telegram Bot API (issue #55/F8): a sendMessage whose text
// exceeds the 4096-character limit is rejected with "message is too long"
// rather than silently accepted. Without this, an oversized-reply bug would
// pass the test suite even though it fails against the real API.
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

let userIdSeq = 1;
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
    wizardStateStore: new InMemoryWizardStateStore(),
    activeCohortId,
    dashboardUrl: "http://localhost:1234",
    bot,
    roster,
  });
  return { ...created, calls };
}

function messageUpdate(userId: number, chatId: number, text: string): Update {
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

function groupMessageUpdate(userId: number, username: string, chatId: number, text: string): Update {
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
      chat: { id: chatId, type: "group", title: "Dump Group" },
      from: { id: userId, is_bot: false, first_name: "Test", username },
      text,
      ...(entities ? { entities } : {}),
    },
  } as Update;
}

function callbackUpdate(userId: number, chatId: number, data: string): Update {
  return {
    update_id: updateIdSeq++,
    callback_query: {
      id: String(updateIdSeq),
      from: { id: userId, is_bot: false, first_name: "Test" },
      chat_instance: "1",
      data,
      message: {
        message_id: messageIdSeq++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private" },
        text: "placeholder",
      },
    },
  } as Update;
}

function lastReplyText(calls: RecordedCall[]): string {
  const call = [...calls].reverse().find(
    (c) => c.method === "sendMessage" || c.method === "editMessageText",
  );
  return (call?.payload.text as string) ?? "";
}

function lastKeyboardCallbackData(calls: RecordedCall[]): string[] {
  const call = [...calls].reverse().find(
    (c) => c.method === "sendMessage" || c.method === "editMessageText",
  );
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: { callback_data?: string }[][] }
    | undefined;
  if (!markup?.inline_keyboard) return [];
  return markup.inline_keyboard.flat().map((b) => b.callback_data ?? "");
}

async function registerCaller(
  created: CreatedBot,
  userId: number,
  username: string,
) {
  await created.registrations.register(userId, username);
}

describe("/edit wizard field picker", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  async function seedTask(): Promise<number> {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const result = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Original title",
        description: "Original description",
        dueDate: "2026-09-05",
      },
    );
    if (!result.ok) throw new Error("setup failed: " + result.error);
    return result.value.id;
  }

  it("/edit <id> shows a 4-button field-choice menu instead of asking for assignee", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Which field");
    expect(text).not.toMatch(/new assignee/i);
    const dataButtons = lastKeyboardCallbackData(testBot.calls);
    expect(dataButtons.sort()).toEqual(
      ["editfield:assignee", "editfield:description", "editfield:duedate", "editfield:title"].sort(),
    );
  });

  it("tapping Title then sending a new title saves only the title", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "editfield:title"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Brand new title"));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Brand new title");
      expect(result.value.description).toBe("Original description");
      expect(result.value.assigneeUsername).toBe("alice");
      expect(result.value.dueDate).toBe("2026-09-05");
    }

    // Should not have asked for description or due date afterward.
    const text = lastReplyText(testBot.calls);
    expect(text).not.toMatch(/description\?/i);
    expect(text).not.toMatch(/due date/i);
    expect(text).toMatch(/updated/i);
  });

  it("tapping Due date still goes through natural-language parse + Yes/No confirm before saving", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "editfield:duedate"));
    // An absolute date, not a relative one: bot uses a real SystemClock, and
    // a relative input like "in 3 days" would coincidentally resolve to the
    // same value as the seeded fixture date on some real-world "today"s.
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Dec 25 2026"));

    // Should now be showing a Yes/No confirm, not have saved yet.
    let text = lastReplyText(testBot.calls);
    expect(text).toMatch(/save this\?/i);
    const dataButtons = lastKeyboardCallbackData(testBot.calls);
    expect(dataButtons.sort()).toEqual(["duedate:no", "duedate:yes"]);

    let result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.dueDate).toBe("2026-09-05"); // unchanged so far

    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "duedate:yes"));

    result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dueDate).not.toBe("2026-09-05");
      expect(result.value.title).toBe("Original title"); // untouched
    }
  });

  it("the wizard's due-date confirm prompt warns when the parsed date is in the past (F10)", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "editfield:duedate"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Jan 5 2020"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/save this\?/i);
    expect(text).toContain("⚠️ That due date is already in the past.");
  });

  it("the wizard's due-date confirm prompt does not warn for a future date (F10)", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "editfield:duedate"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Dec 25 2026"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/save this\?/i);
    expect(text).not.toContain("already in the past");
  });

  it("tapping Assignee with a higher-up's username reassigns to them — assignment isn't intern-only (issue #27/#29)", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "editfield:assignee"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "carla")); // higher-up, not intern

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.assigneeUsername).toBe("carla");
  });

  it("tapping Assignee with a close-typo username gets a 'did you mean' suggestion (issue #8)", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "editfield:assignee"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "alicw")); // typo of alice

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/isn't a known roster member/i);
    expect(text).toMatch(/did you mean @alice/i);

    // still waiting for the next message: no auto-accept
    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.assigneeUsername).toBe("alice"); // unchanged (was already alice)
    expect(await testBot.wizards.has(higherUpId)).toBe(true);

    // caller must type the corrected username themselves
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "bob"));
    const updated = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(updated.ok && updated.value.assigneeUsername).toBe("bob");
  });

  it("a username with no close match gets the plain rejection, no suggestion", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "editfield:assignee"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "zephyrxyz"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/isn't a known roster member/i);
    expect(text).not.toMatch(/did you mean/i);
  });

  it("equally-close matches across two interns falls back to the plain rejection (no ambiguous guess)", async () => {
    const ambiguousRoster = new Roster([
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { username: "alice", role: "Intern", cohortId: COHORT },
      { username: "alicf", role: "Intern", cohortId: COHORT },
    ]);
    const ambiguousBot = makeTestBot(ambiguousRoster);
    const higherUpId = nextUserId();
    await registerCaller(ambiguousBot, higherUpId, "carla");
    const created = await ambiguousBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "T",
        description: "d",
        dueDate: "2026-09-05",
      },
    );
    if (!created.ok) throw new Error("seed failed");
    const taskId = created.value.id;

    await ambiguousBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`),
    );
    await ambiguousBot.bot.handleUpdate(
      callbackUpdate(higherUpId, higherUpId, "editfield:assignee"),
    );
    await ambiguousBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "alicx")); // distance 1 from both alice/alicf

    const text = lastReplyText(ambiguousBot.calls);
    expect(text).toMatch(/isn't a known roster member/i);
    expect(text).not.toMatch(/did you mean/i);
  });

  it("/edit on a done task still shows the field menu — the Approved edit-lock is gone (issue #27/#28)", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const alice = { username: "alice", role: "Intern" as const, cohortId: COHORT };
    await testBot.service.setStatus(alice, taskId, "done");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Which field");
    expect(await testBot.wizards.has(higherUpId)).toBe(true);
  });

  it("/cancel aborts the wizard at the field-choice stage", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    expect(await testBot.wizards.has(higherUpId)).toBe(true);
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/cancel"));
    expect(await testBot.wizards.has(higherUpId)).toBe(false);

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/cancelled/i);
  });
});

describe("direct /edit <task_id> <field> <value> (issue #30)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  async function seedTask(): Promise<number> {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const result = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Original title",
        description: "Original description",
        dueDate: "2026-09-05",
      },
    );
    if (!result.ok) throw new Error("setup failed: " + result.error);
    return result.value.id;
  }

  it("edits the title directly, without starting the wizard", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} title Brand new title`),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/updated/i);
    expect(await testBot.wizards.has(higherUpId)).toBe(false);

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe("Brand new title");
  });

  it("edits the assignee directly", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} assignee bob`),
    );

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assigneeUsername).toBe("bob");
  });

  it("edits the description directly", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} description A brand new description`),
    );

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBe("A brand new description");
  });

  it("edits the due date directly, via parseDueDate", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} duedate Sept 20`),
    );

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dueDate).toBe("2026-09-20");
  });

  it("warns when the direct duedate edit resolves to a past date (F10)", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} duedate Jan 5 2020`),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("⚠️ That due date is already in the past.");
  });

  it("does not warn when the direct duedate edit resolves to a future date (F10)", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} duedate Sept 20`),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).not.toContain("already in the past");
  });

  it("does not warn when editing a non-duedate field (F10)", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} title Brand new title`),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).not.toContain("already in the past");
  });

  it("rejects a due-date value chrono cannot parse, with usage help rather than silently defaulting", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} duedate blorpsday`),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/couldn't understand that date/i);

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dueDate).toBe("2026-09-05"); // unchanged
  });

  it("rejects an unknown assignee, with a suggestion when close", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/edit ${taskId} assignee bobb`), // typo of bob
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/isn't a known roster member/i);
    expect(text).toMatch(/did you mean @bob/i);
  });

  it("bare /edit <id> still falls back to the field-choice wizard", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Which field");
    expect(await testBot.wizards.has(higherUpId)).toBe(true);
  });
});

describe("Review-gate commands are removed with a helpful redirect, not the generic fallback (issue #27/#31)", () => {
  it.each([
    ["/submit", "/done"],
    ["/approve", "/complete"],
    ["/revise", "/update"],
    ["/canceltask", "/update"],
    ["/unblocked", "/unblock"],
  ] as const)("%s replies pointing at %s instead of 'Not sure what you mean'", async (removed, replacement) => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `${removed} 1`));

    const text = lastReplyText(testBot.calls);
    expect(text).not.toMatch(/not sure what you mean/i);
    expect(text).toContain(replacement);
  });

  it("no inline keyboard is offered for the removed /canceltask — the confirm flow it drove is gone too", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/canceltask 1"));

    expect(lastKeyboardCallbackData(testBot.calls)).toEqual([]);
  });
});

describe("bare /addtask falls back to the step-by-step wizard (issue #30)", () => {
  it("walks assignee -> title -> description -> due date -> confirm -> creates the task", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    let text = lastReplyText(testBot.calls);
    expect(text).toMatch(/who is this task for/i);

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "alice"));
    text = lastReplyText(testBot.calls);
    expect(text).toMatch(/title/i);

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Ship the feature"));
    text = lastReplyText(testBot.calls);
    expect(text).toMatch(/description/i);

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Ship it end to end"));
    text = lastReplyText(testBot.calls);
    expect(text).toMatch(/due date/i);

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "in 5 days"));
    text = lastReplyText(testBot.calls);
    expect(text).toMatch(/save this\?/i);

    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "duedate:yes"));

    const list = await testBot.service.listAllTasks({
      username: "carla",
      role: "HigherUp",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0]?.title).toBe("Ship the feature");
      expect(list.value[0]?.description).toBe("Ship it end to end");
      expect(list.value[0]?.assigneeUsername).toBe("alice");
    }
  });

  it("lets the description step be skipped, leaving the task with no description (issue #27/#30)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "alice"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Ship the feature"));
    const descriptionPrompt = lastReplyText(testBot.calls);
    expect(descriptionPrompt).toMatch(/skip/i);

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "skip"));
    let text = lastReplyText(testBot.calls);
    expect(text).toMatch(/due date/i);

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "in 5 days"));
    text = lastReplyText(testBot.calls);
    expect(text).toMatch(/save this\?/i);
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "duedate:yes"));

    const list = await testBot.service.listAllTasks({
      username: "carla",
      role: "HigherUp",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0]?.description).toBeUndefined();
    }
  });

  it("suggests a close-typo username during the wizard's first step too (issue #8)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "bobb")); // typo of bob

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/isn't a known roster member/i);
    expect(text).toMatch(/did you mean @bob/i);
    expect(await testBot.wizards.has(higherUpId)).toBe(true);
  });

  it("the assignment DM points to /done, not the removed /submit (F11)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "alice"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Ship the feature"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "skip"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "in 5 days"));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "duedate:yes"));

    const dmToAlice = testBot.calls.find(
      (c) => c.method === "sendMessage" && Number(c.payload.chat_id) === aliceId,
    );
    expect(dmToAlice?.payload.text).toContain("/done");
    expect(dmToAlice?.payload.text).not.toContain("/submit");
  });

  it("can assign to a HigherUp — assignment is no longer intern-only (issue #27/#29)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "carla"));
    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/title/i);
  });
});

describe("Stage 4: wizards are scoped to the chat they were started in (issue #52/#53, finding F3)", () => {
  const GROUP_CHAT_ID = -200;

  it("a wizard started in a DM ignores plain text sent in a group by the same user", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    const callsBefore = testBot.calls.length;

    await testBot.bot.handleUpdate(
      groupMessageUpdate(higherUpId, "carla", GROUP_CHAT_ID, "hey everyone good morning"),
    );

    expect(testBot.calls.length).toBe(callsBefore);
    const state = await testBot.wizards.get(higherUpId);
    expect(state?.step).toBe("awaiting_assignee");
  });

  it("a wizard started in a DM still advances when answered in that same DM (regression guard)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "alice"));

    expect(lastReplyText(testBot.calls)).toMatch(/title/i);
  });

  it("a wizard started in a group still advances when answered in that same group (regression guard for CONTEXT.md:78)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(groupMessageUpdate(higherUpId, "carla", GROUP_CHAT_ID, "/addtask"));
    await testBot.bot.handleUpdate(groupMessageUpdate(higherUpId, "carla", GROUP_CHAT_ID, "alice"));

    expect(lastReplyText(testBot.calls)).toMatch(/title/i);
  });

  it("a command in a different chat does not cancel an in-progress wizard", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(groupMessageUpdate(higherUpId, "carla", GROUP_CHAT_ID, "/help"));

    const replies = testBot.calls
      .filter((c) => c.method === "sendMessage")
      .map((c) => c.payload.text as string);
    expect(replies.some((t) => /cancelled your in-progress form/i.test(t))).toBe(false);
    expect(lastReplyText(testBot.calls)).not.toMatch(/cancelled/i);
    const state = await testBot.wizards.get(higherUpId);
    expect(state?.step).toBe("awaiting_assignee");
  });

  it("a command in the same chat still cancels an in-progress wizard (existing behaviour)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/help"));

    const replies = testBot.calls
      .filter((c) => c.method === "sendMessage")
      .map((c) => c.payload.text as string);
    expect(replies.some((t) => /cancelled your in-progress form/i.test(t))).toBe(true);
    expect(await testBot.wizards.has(higherUpId)).toBe(false);
  });

  it("a duedate callback from a mismatched chat is rejected and does not save", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "alice"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "Ship the feature"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "skip"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "in 5 days"));

    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, GROUP_CHAT_ID, "duedate:yes"));

    const answerCall = [...testBot.calls].reverse().find((c) => c.method === "answerCallbackQuery");
    expect(answerCall?.payload.text).toBe("That form was started in another chat.");
    const list = await testBot.service.listAllTasks({
      username: "carla",
      role: "HigherUp",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(0);
  });

  it("a wizard row with no chatId (pre-deploy row) still accepts input from any chat", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.wizards.start(higherUpId, "assign");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(higherUpId, "carla", GROUP_CHAT_ID, "alice"),
    );

    expect(lastReplyText(testBot.calls)).toMatch(/title/i);
  });
});

describe("direct /addtask one-liner (issue #27/#30)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  async function addtask(userId: number, args: string) {
    await testBot.bot.handleUpdate(messageUpdate(userId, userId, `/addtask ${args}`));
  }

  it("title only: assigns to the caller, due the coming Friday, Asia/Manila", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await addtask(internId, "Fix the login page");

    const list = await testBot.service.listAllTasks({
      username: "alice",
      role: "Intern",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0]?.title).toBe("Fix the login page");
      expect(list.value[0]?.assigneeUsername).toBe("alice");
      expect(list.value[0]?.description).toBeUndefined();
      expect(list.value[0]?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("title + date: parses the 'by <date>' clause", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await addtask(internId, "Fix the login page by Sept 5");

    const list = await testBot.service.listAllTasks({
      username: "alice",
      role: "Intern",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value[0]?.title).toBe("Fix the login page");
      expect(list.value[0]?.dueDate).toBe("2026-09-05");
    }
  });

  it("title + assignee: assigns to the named roster member instead of the caller", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await addtask(higherUpId, "Fix the login page @alice");

    const list = await testBot.service.listAllTasks({
      username: "carla",
      role: "HigherUp",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value[0]?.title).toBe("Fix the login page");
      expect(list.value[0]?.assigneeUsername).toBe("alice");
    }
  });

  it("title + date + assignee, date before the mention", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await addtask(higherUpId, "fix the login by Sept 5 @alice");

    const list = await testBot.service.listAllTasks({
      username: "carla",
      role: "HigherUp",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value[0]?.title).toBe("fix the login");
      expect(list.value[0]?.dueDate).toBe("2026-09-05");
      expect(list.value[0]?.assigneeUsername).toBe("alice");
    }
  });

  it("title + date + assignee, mention before the date", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await addtask(higherUpId, "fix the login @alice by Sept 5");

    const list = await testBot.service.listAllTasks({
      username: "carla",
      role: "HigherUp",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value[0]?.title).toBe("fix the login");
      expect(list.value[0]?.dueDate).toBe("2026-09-05");
      expect(list.value[0]?.assigneeUsername).toBe("alice");
    }
  });

  it("a title that legitimately contains the word 'by' is kept whole", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await addtask(internId, "Review the process used by the onboarding team");

    const list = await testBot.service.listAllTasks({
      username: "alice",
      role: "Intern",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value[0]?.title).toBe("Review the process used by the onboarding team");
    }
  });

  it("rejects an @username that isn't on the roster, with a suggestion when close", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await addtask(internId, "Fix the login page @bobb"); // typo of bob

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/isn't a known roster member/i);
    expect(text).toMatch(/did you mean @bob/i);

    const list = await testBot.service.listAllTasks({
      username: "alice",
      role: "Intern",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(0);
  });

  it("any roster member can create a task — task creation is no longer higher-up only (issue #27)", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await addtask(internId, "Fix the login page");

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/created/i);
  });

  it("warns when the resolved due date is already in the past (F10)", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await addtask(internId, "retro writeup by Jan 5 2020");

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("⚠️ That due date is already in the past.");
  });

  it("does not warn when the resolved due date is in the future (F10)", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await addtask(internId, "fix the login by Sept 5");

    const text = lastReplyText(testBot.calls);
    expect(text).not.toContain("already in the past");
  });

  describe("the coming-Friday default, Asia/Manila", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves to the coming Friday when sent on a Friday", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-04T02:00:00.000Z")); // Friday, 10:00 Manila
      const internId = nextUserId();
      await registerCaller(testBot, internId, "alice");

      await addtask(internId, "Fix the login page");

      const list = await testBot.service.listAllTasks({
        username: "alice",
        role: "Intern",
        cohortId: COHORT,
      });
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.value[0]?.dueDate).toBe("2026-09-04");
    });

    it("resolves to the coming Friday when sent over the weekend", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-06T02:00:00.000Z")); // Sunday, 10:00 Manila
      const internId = nextUserId();
      await registerCaller(testBot, internId, "alice");

      await addtask(internId, "Fix the login page");

      const list = await testBot.service.listAllTasks({
        username: "alice",
        role: "Intern",
        cohortId: COHORT,
      });
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.value[0]?.dueDate).toBe("2026-09-11");
    });
  });
});

describe("mention trigger: @bot pls work on <title> (issue #34)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;
  const GROUP_CHAT_ID = -100;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  for (const phrase of ["pls work on", "please work on", "add task", "new task", "todo"]) {
    it(`creates a task via "@test_bot ${phrase} <title>" in the group`, async () => {
      const internId = nextUserId();
      await registerCaller(testBot, internId, "alice");

      await testBot.bot.handleUpdate(
        groupMessageUpdate(internId, "alice", GROUP_CHAT_ID, `@test_bot ${phrase} fix login`),
      );

      const list = await testBot.service.listAllTasks({
        username: "alice",
        role: "Intern",
        cohortId: COHORT,
      });
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.value).toHaveLength(1);
        expect(list.value[0]?.title).toBe("fix login");
        expect(list.value[0]?.assigneeUsername).toBe("alice");
      }
      expect(lastReplyText(testBot.calls)).toMatch(/created/i);
    });
  }

  it("does nothing for ordinary unmentioned group chatter containing 'add task'", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(internId, "alice", GROUP_CHAT_ID, "someone should add task the login bug"),
    );

    expect(testBot.calls).toHaveLength(0);
    const list = await testBot.service.listAllTasks({
      username: "alice",
      role: "Intern",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(0);
  });

  it("replies with a redirect when mentioned with no recognisable intent", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(internId, "alice", GROUP_CHAT_ID, "@test_bot how's it going"),
    );

    expect(lastReplyText(testBot.calls)).toBe(
      "Did you mean to create a task? Try: @test_bot add task <title>",
    );
    const list = await testBot.service.listAllTasks({
      username: "alice",
      role: "Intern",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(0);
  });

  it("recognises a mention inside a longer sentence", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(
        internId,
        "alice",
        GROUP_CHAT_ID,
        "hey team, @test_bot pls work on the login bug",
      ),
    );

    const list = await testBot.service.listAllTasks({
      username: "alice",
      role: "Intern",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value[0]?.title).toBe("the login bug");
  });

  it("supports a mention plus assignment plus date", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(
        higherUpId,
        "carla",
        GROUP_CHAT_ID,
        "@test_bot add task fix login by Sept 5 @alice",
      ),
    );

    const list = await testBot.service.listAllTasks({
      username: "carla",
      role: "HigherUp",
      cohortId: COHORT,
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value[0]?.title).toBe("fix login");
      expect(list.value[0]?.dueDate).toBe("2026-09-05");
      expect(list.value[0]?.assigneeUsername).toBe("alice");
    }
  });

  it("still requires /start first — an unregistered mentioner gets the registration prompt, not a task", async () => {
    const internId = nextUserId();

    await testBot.bot.handleUpdate(
      groupMessageUpdate(internId, "ghost", GROUP_CHAT_ID, "@test_bot add task fix login"),
    );

    expect(lastReplyText(testBot.calls)).toMatch(/\/start first/i);
  });

  it("does not fire the wizard's DM-only 'Not sure what you mean' fallback for unmentioned group chatter", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(internId, "alice", GROUP_CHAT_ID, "just chatting about nothing in particular"),
    );

    expect(testBot.calls).toHaveLength(0);
  });

  it("does not reply to a casual embedded mention with no intent phrase (issue #52, F7)", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(internId, "alice", GROUP_CHAT_ID, "thanks @test_bot !"),
    );

    expect(testBot.calls).toHaveLength(0);
  });
});

describe("group chat does not answer other bots' commands or bare unknown commands (issue #52, F6)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;
  const GROUP_CHAT_ID = -100;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  it("does not reply to a slash command explicitly addressed to another bot", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await testBot.bot.handleUpdate(
      groupMessageUpdate(internId, "alice", GROUP_CHAT_ID, "/poll@other_bot What's for lunch?"),
    );

    expect(testBot.calls).toHaveLength(0);
  });

  it("does not reply to an unknown command with no @target in a group", async () => {
    const internId = nextUserId();
    await registerCaller(testBot, internId, "alice");

    await testBot.bot.handleUpdate(groupMessageUpdate(internId, "alice", GROUP_CHAT_ID, "/nonsense"));

    expect(testBot.calls).toHaveLength(0);
  });

  it("still replies to an unknown command with no @target in a DM (unchanged behaviour)", async () => {
    const userId = nextUserId();
    await registerCaller(testBot, userId, "alice");

    await testBot.bot.handleUpdate(messageUpdate(userId, userId, "/nonsense"));

    expect(lastReplyText(testBot.calls)).toBe("Not sure what you mean — try /help");
  });

  it("does not reply to an unknown command explicitly addressed to another bot, even in a DM", async () => {
    const userId = nextUserId();
    await registerCaller(testBot, userId, "alice");

    await testBot.bot.handleUpdate(messageUpdate(userId, userId, "/nonsense@other_bot"));

    expect(testBot.calls).toHaveLength(0);
  });
});

describe("/blocked (no arguments): read-only blocked list, issue #6", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  it("a higher-up sees every blocked task in the cohort, with assignee shown", async () => {
    const aliceTask = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft it",
        dueDate: "2026-09-05",
      },
    );
    if (!aliceTask.ok) throw new Error("setup failed");
    await testBot.service.setBlocked(
      { username: "alice", role: "Intern", cohortId: COHORT },
      aliceTask.value.id,
      "waiting on API access",
    );

    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/blocked"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain(`#${aliceTask.value.id}`);
    expect(text).toContain("@alice");
    expect(text).toContain("waiting on API access");
  });

  it("an intern sees the whole cohort's blocked tasks, not just their own (issue #27/#28 — read access is cohort-wide)", async () => {
    const aliceTask = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft it",
        dueDate: "2026-09-05",
      },
    );
    const bobTask = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "bob",
        title: "Set up CI",
        description: "Configure it",
        dueDate: "2026-09-05",
      },
    );
    if (!aliceTask.ok || !bobTask.ok) throw new Error("setup failed");
    await testBot.service.setBlocked(
      { username: "alice", role: "Intern", cohortId: COHORT },
      aliceTask.value.id,
      "waiting on API access",
    );
    await testBot.service.setBlocked(
      { username: "bob", role: "Intern", cohortId: COHORT },
      bobTask.value.id,
      "waiting on design review",
    );

    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/blocked"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain(`#${aliceTask.value.id}`);
    expect(text).toContain(`#${bobTask.value.id}`);
    expect(text).toContain("design review");
  });

  it("a caller with zero blocked tasks gets a clear 'nothing blocked' message", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/blocked"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/nothing.*blocked/i);
  });

  it("/blocked <id> <reason> still flags a task as blocked (regression: shared command name)", async () => {
    const aliceTask = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft it",
        dueDate: "2026-09-05",
      },
    );
    if (!aliceTask.ok) throw new Error("setup failed");

    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(
      messageUpdate(aliceId, aliceId, `/blocked ${aliceTask.value.id} waiting on API access`),
    );

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/flagged as blocked/i);

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      aliceTask.value.id,
    );
    expect(result.ok && result.value.status).toBe("blocked");
  });
});

describe("Blocked notifications have no inline buttons — the review gate they encoded is gone (issue #27/#29)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  async function seedBlockedTask(): Promise<{ taskId: number; higherUpId: number; aliceId: number }> {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft it",
        dueDate: "2026-09-05",
      },
    );
    if (!task.ok) throw new Error("setup failed");
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(
      messageUpdate(aliceId, aliceId, `/blocked ${task.value.id} waiting on API access`),
    );
    return { taskId: task.value.id, higherUpId, aliceId };
  }

  it("the blocked notification to the assigning higher-up has no 'Mark unblocked' button", async () => {
    await seedBlockedTask();

    const callbackData = lastKeyboardCallbackData(testBot.calls);
    expect(callbackData).toEqual([]);
    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/flagged as blocked/i);
  });

  it("the removed unblock: callback is unrecognized — tapping a stale button does nothing", async () => {
    const { taskId, higherUpId } = await seedBlockedTask();

    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, `unblock:${taskId}`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).toBe("blocked");
  });

  it("/unblock <task_id> restores the previous status (renamed from /unblocked, issue #31)", async () => {
    const { taskId, higherUpId } = await seedBlockedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/unblock ${taskId}`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).not.toBe("blocked");
    expect(lastReplyText(testBot.calls)).toMatch(/no longer blocked/i);
  });

  it("/unblock also accepts a t-prefixed task ref", async () => {
    const { taskId, higherUpId } = await seedBlockedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/unblock t${taskId}`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).not.toBe("blocked");
  });
});

describe("/task <id> appends a per-status next-step hint (issue #27/#29/#31)", () => {
  it("hints at /done for a todo task", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/task ${task.value.id}`));
    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Status: To do");
    expect(text).toMatch(/\/done/);
  });

  it("also accepts a t-prefixed ref (/task t<id>), issue #31's shared ref parser", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/task t${task.value.id}`));
    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Status: To do");
  });

  it("hints 'Nice work!' for a done task", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");
    await testBot.service.setStatus({ username: "carla", role: "HigherUp", cohortId: COHORT }, task.value.id, "done");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/task ${task.value.id}`));
    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Nice work!");
  });

  it("a task with enough notes to exceed Telegram's 4096-character limit sends multiple messages and does not throw (issue #55/F8)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");
    for (let i = 0; i < 80; i++) {
      await testBot.bot.handleUpdate(
        messageUpdate(
          higherUpId,
          higherUpId,
          `/note ${task.value.id} A reasonably descriptive note to pad this out, number ${i}`,
        ),
      );
    }

    const callsBefore = testBot.calls.length;
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/task ${task.value.id}`));

    const replies = testBot.calls
      .slice(callsBefore)
      .filter((c) => c.method === "sendMessage" && Number(c.payload.chat_id) === higherUpId);
    expect(replies.length).toBeGreaterThan(1);
    for (const reply of replies) {
      expect((reply.payload.text as string).length).toBeLessThanOrEqual(4096);
    }
  });
});

describe("Notification policy on status changes (issue #27/#29)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  // Distinct from the command's own chat, so a notification DM is never
  // confused with the bot's direct reply to whoever sent the command (both
  // go through the same fake "sendMessage" transformer call).
  function sentDMs(actingChatId: number): string[] {
    return testBot.calls
      .filter((c) => c.method === "sendMessage" && Number(c.payload.chat_id) !== actingChatId)
      .map((c) => String(c.payload.chat_id));
  }

  it("/blocked DMs both the assignee and the creator when a third party acts", async () => {
    const carlaId = nextUserId();
    await registerCaller(testBot, carlaId, "carla");
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    const bobId = nextUserId();
    await registerCaller(testBot, bobId, "bob");

    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(
      messageUpdate(bobId, bobId, `/blocked ${task.value.id} waiting on access`),
    );

    const dms = sentDMs(bobId);
    expect(dms).toContain(String(aliceId));
    expect(dms).toContain(String(carlaId));
    expect(dms).not.toContain(String(bobId));
    expect(dms).toHaveLength(2);
  });

  it("skips the actor when the actor is the assignee (submitting your own task)", async () => {
    const carlaId = nextUserId();
    await registerCaller(testBot, carlaId, "carla");
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");

    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, `/done ${task.value.id}`));

    const dms = sentDMs(aliceId);
    expect(dms).not.toContain(String(aliceId));
    expect(dms).toContain(String(carlaId));
    expect(dms).toHaveLength(1);
  });

  it("dedupes so a task's creator-and-assignee gets only one DM, not two", async () => {
    const carlaId = nextUserId();
    await registerCaller(testBot, carlaId, "carla");
    const bobId = nextUserId();
    await registerCaller(testBot, bobId, "bob");

    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "carla", title: "Self-assigned", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(messageUpdate(bobId, bobId, `/complete ${task.value.id}`));

    const dms = sentDMs(bobId);
    expect(dms.filter((id) => id === String(carlaId))).toHaveLength(1);
  });
});

describe("Stage 5: notification correctness (issue #54, findings F4/F5/F13)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  function sentDMs(actingChatId: number): string[] {
    return testBot.calls
      .filter((c) => c.method === "sendMessage" && Number(c.payload.chat_id) !== actingChatId)
      .map((c) => String(c.payload.chat_id));
  }

  it("a roster username with capital-letter casing doesn't self-DM (F4) — completing your own task sends only the reply", async () => {
    const mixedCaseRoster = new Roster([
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { username: "Alice", role: "Intern", cohortId: COHORT },
    ]);
    const mixedCaseBot = makeTestBot(mixedCaseRoster);
    const aliceId = nextUserId();
    await registerCaller(mixedCaseBot, aliceId, "alice");

    const task = await mixedCaseBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");

    await mixedCaseBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, `/complete ${task.value.id}`));

    const sendMessageCalls = mixedCaseBot.calls.filter((c) => c.method === "sendMessage");
    expect(sendMessageCalls).toHaveLength(1);
    expect(Number(sendMessageCalls[0]?.payload.chat_id)).toBe(aliceId);
  });

  it("a command whose notification lookup throws still replies with its normal success text (F5)", async () => {
    const { calls, transformer } = makeFakeTransformer();
    const bot = new Bot("TEST_TOKEN", { botInfo: FAKE_BOT_INFO });
    bot.api.config.use(transformer);
    const brokenRegistrations: RegistrationStorePort = {
      register: async (userId, username) => {
        await underlying.register(userId, username);
      },
      findUsername: async (userId) => underlying.findUsername(userId),
      findTelegramId: async () => {
        throw new Error("duplicate rows for username — .maybeSingle() failure");
      },
    };
    const underlying = new InMemoryRegistrationStore();
    const created = createBot({
      token: "TEST_TOKEN",
      taskStore: new InMemoryTaskStore(),
      registrationStore: brokenRegistrations,
      wizardStateStore: new InMemoryWizardStateStore(),
      activeCohortId: COHORT,
      dashboardUrl: "http://localhost:1234",
      bot,
      roster,
    });

    const carlaId = nextUserId();
    await underlying.register(carlaId, "carla");
    const task = await created.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");

    await created.bot.handleUpdate(messageUpdate(carlaId, carlaId, `/blocked ${task.value.id} stuck`));

    expect(lastReplyText(calls)).toMatch(/flagged as blocked/i);
  });

  it("/addtask ... @bob where bob has never run /start warns in the reply (F13)", async () => {
    const carlaId = nextUserId();
    await registerCaller(testBot, carlaId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(carlaId, carlaId, "/addtask ship it @bob"));

    expect(lastReplyText(testBot.calls)).toMatch(/hasn't sent \/start yet/i);
  });

  it("/addtask ... @bob where bob has registered does not warn, and bob gets a DM (F13)", async () => {
    const carlaId = nextUserId();
    await registerCaller(testBot, carlaId, "carla");
    const bobId = nextUserId();
    await registerCaller(testBot, bobId, "bob");

    await testBot.bot.handleUpdate(messageUpdate(carlaId, carlaId, "/addtask ship it @bob"));

    expect(lastReplyText(testBot.calls)).not.toMatch(/hasn't sent \/start yet/i);
    expect(sentDMs(carlaId)).toContain(String(bobId));
  });

  it("/addtask ... self-assigned does not warn, even though no DM is sent (F13)", async () => {
    const carlaId = nextUserId();
    await registerCaller(testBot, carlaId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(carlaId, carlaId, "/addtask ship it"));

    expect(lastReplyText(testBot.calls)).not.toMatch(/hasn't sent \/start yet/i);
  });

  it("bulk /update t1,t2 done still collapses to one summary DM per recipient (regression guard on #32)", async () => {
    const carlaId = nextUserId();
    await registerCaller(testBot, carlaId, "carla");
    const bobId = nextUserId();
    await registerCaller(testBot, bobId, "bob");

    const t1 = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "bob", title: "Task 1", description: "d", dueDate: "2026-09-05" },
    );
    const t2 = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "bob", title: "Task 2", description: "d", dueDate: "2026-09-05" },
    );
    if (!t1.ok || !t2.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(
      messageUpdate(carlaId, carlaId, `/update t${t1.value.id},t${t2.value.id} done`),
    );

    const dmsToBob = testBot.calls.filter(
      (c) => c.method === "sendMessage" && Number(c.payload.chat_id) === bobId,
    );
    expect(dmsToBob).toHaveLength(1);
  });
});

describe("/tasks and /mytasks pagination (issue #7/#33)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  async function assignEleven() {
    for (let i = 1; i <= 11; i++) {
      const result = await testBot.service.assignTask(
        { username: "carla", role: "HigherUp", cohortId: COHORT },
        {
          assigneeUsername: "alice",
          title: `Task ${i}`,
          description: "d",
          dueDate: "2026-09-05",
        },
      );
      if (!result.ok) throw new Error("setup failed");
    }
  }

  it("/mytasks with 11 tasks shows page 1 of 2 and hints at the next page", async () => {
    await assignEleven();
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/mytasks"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("/mytasks 2");
    expect(text).toContain("#1");
    expect(text).not.toContain("#11");
  });

  it("/mytasks 2 shows the second page", async () => {
    await assignEleven();
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/mytasks 2"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("#11");
  });

  it("/tasks with no filter and a small result set shows no pagination footer", async () => {
    const result = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "d",
        dueDate: "2026-09-05",
      },
    );
    if (!result.ok) throw new Error("setup failed");
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tasks"));

    const text = lastReplyText(testBot.calls);
    expect(text).not.toMatch(/Page \d+ of \d+/);
    expect(text).toContain("@alice:");
  });

  it("/tasks 2 paginates and preserves grouping by assignee within a page", async () => {
    await assignEleven();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tasks 2"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("@alice:");
    expect(text).toContain("#11");
  });

  it("/tasks @username filters to that roster member's tasks", async () => {
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "alice's task", dueDate: "2026-09-05" },
    );
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "bob", title: "bob's task", dueDate: "2026-09-05" },
    );
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tasks @alice"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("alice's task");
    expect(text).not.toContain("bob's task");
  });

  it("/tasks @nonroster reports the username isn't a known roster member", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tasks @nobody"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/isn't a known roster member/i);
  });

  it("/tasks intern filters to tasks assigned to interns", async () => {
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "alice's task", dueDate: "2026-09-05" },
    );
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "carla", title: "carla's task", dueDate: "2026-09-05" },
    );
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tasks intern"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("alice's task");
    expect(text).not.toContain("carla's task");
  });

  it("/tasks higherup filters to tasks assigned to higher-ups", async () => {
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "alice's task", dueDate: "2026-09-05" },
    );
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "carla", title: "carla's task", dueDate: "2026-09-05" },
    );
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tasks higherup"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("carla's task");
    expect(text).not.toContain("alice's task");
  });

  it("/tasks with an argument that's neither a page, @username, nor role word gets a usage message", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tasks banana"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/usage/i);
  });

  it("/alltasks redirects to /tasks (issue #33 — no alias retained)", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/alltasks"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/\/alltasks is now \/tasks/i);
  });

  it("/mytasks with a non-numeric page argument gets a usage message", async () => {
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/mytasks abc"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/usage/i);
  });
});

describe("/deadlines (issue #33)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  it("says nothing is due when there's nothing in the window", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/deadlines"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/nothing due/i);
  });

  it("lists a task due soon, cohort-wide", async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const dueDate = soon.toISOString().slice(0, 10);
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "due soon task", dueDate },
    );
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/deadlines"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("due soon task");
  });
});

describe("/standup (issue #33)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  it("includes task titles, unlike the counts-only daily/weekly digest", async () => {
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Write the onboarding doc", dueDate: "2026-09-05" },
    );
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/standup"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Write the onboarding doc");
  });

  it("renders a status-count overview, even with an empty cohort", async () => {
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/standup"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Overview");
    expect(text).toMatch(/To do: 0/);
    expect(text).toMatch(/no tasks completed this week/i);
  });

  it("a report large enough to exceed Telegram's 4096-character limit is chunked, not thrown (issue #55/F8)", async () => {
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    for (let i = 0; i < 60; i++) {
      await testBot.service.assignTask(
        { username: "carla", role: "HigherUp", cohortId: COHORT },
        {
          assigneeUsername: "alice",
          title: `Task number ${i} — a reasonably descriptive title to pad it out`,
          dueDate: "2026-09-05",
        },
      );
    }

    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/standup"));

    const replies = testBot.calls.filter((c) => c.method === "sendMessage");
    expect(replies.length).toBeGreaterThan(1);
    for (const reply of replies) {
      expect((reply.payload.text as string).length).toBeLessThanOrEqual(4096);
    }
  });

  it("does not list a member who has nothing in a given status", async () => {
    await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Write the onboarding doc", dueDate: "2026-09-05" },
    );
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/standup"));

    const text = lastReplyText(testBot.calls);
    expect(text).not.toContain("@bob");
  });
});

describe("/update <ref> <status> — generic status setter (issue #27/#31)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  async function seedTask(): Promise<{ taskId: number; higherUpId: number; aliceId: number }> {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");
    return { taskId: task.value.id, higherUpId, aliceId };
  }

  it("sets the status named by a bare numeric ref", async () => {
    const { taskId, higherUpId } = await seedTask();
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update ${taskId} in progress`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).toBe("in_progress");
  });

  it("also accepts a t-prefixed ref", async () => {
    const { taskId, higherUpId } = await seedTask();
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update t${taskId} done`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).toBe("done");
  });

  it("/update <ref> blocked sets the status with a null reason and does not reject (issue #27)", async () => {
    const { taskId, higherUpId } = await seedTask();
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update ${taskId} blocked`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).toBe("blocked");
    expect(result.ok && result.value.blockedReason).toBeNull();
  });

  it("an unrecognised status word replies with the list of valid ones, not a generic error", async () => {
    const { taskId, higherUpId } = await seedTask();
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update ${taskId} finished`));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/backlog/);
    expect(text).toMatch(/todo/);
    expect(text).toMatch(/in progress/);
    expect(text).toMatch(/in review/);
    expect(text).toMatch(/blocked/);
    expect(text).toMatch(/done/);
  });

  it("/update <ref> with no status gets the usage message, not an empty-quotes error (F12)", async () => {
    const { taskId, higherUpId } = await seedTask();
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update ${taskId}`));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/^Usage: \/update/);
    expect(text).not.toContain('""');
  });

  it("/update <ref> with a real unrecognised word still names it (F12 regression guard)", async () => {
    const { taskId, higherUpId } = await seedTask();
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update ${taskId} finished`));

    const text = lastReplyText(testBot.calls);
    expect(text).toBe(
      'I don\'t recognize "finished" as a status. Valid statuses: backlog, todo, in progress, in review, blocked, done',
    );
  });

  it("an invalid ref gets a usage message", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/update abc done"));

    expect(lastReplyText(testBot.calls)).toMatch(/usage/i);
  });

  it("notifies the assignee and creator, skipping the actor", async () => {
    const { taskId, higherUpId, aliceId } = await seedTask();
    const bobId = nextUserId();
    await registerCaller(testBot, bobId, "bob");

    await testBot.bot.handleUpdate(messageUpdate(bobId, bobId, `/update ${taskId} done`));

    const dms = testBot.calls
      .filter((c) => c.method === "sendMessage" && Number(c.payload.chat_id) !== bobId)
      .map((c) => Number(c.payload.chat_id));
    expect(dms).toContain(aliceId);
    expect(dms).toContain(higherUpId);
    expect(dms).not.toContain(bobId);
  });
});

describe("Stage 4: bulk and multiline /update, with partial-failure reporting (issue #27/#32)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  async function seedTask(assignee = "alice"): Promise<number> {
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: assignee, title: `Task for ${assignee}`, description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");
    return task.value.id;
  }

  async function statusOf(id: number) {
    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      id,
    );
    return result.ok ? result.value.status : undefined;
  }

  it("all-valid batch: one trailing status governs a comma-separated ref list", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();
    const t2 = await seedTask();
    const t3 = await seedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update t${t1},t${t2},${t3} done`));

    expect(await statusOf(t1)).toBe("done");
    expect(await statusOf(t2)).toBe("done");
    expect(await statusOf(t3)).toBe("done");
    expect(lastReplyText(testBot.calls)).toMatch(/3\/3 updated/);
  });

  it("mixed statuses on one line: each comma segment carries its own status", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();
    const t2 = await seedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update t${t1} done, t${t2} review`));

    expect(await statusOf(t1)).toBe("done");
    expect(await statusOf(t2)).toBe("in_review");
  });

  it("multiline batch: newline-separated <ref> <status> pairs", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();
    const t2 = await seedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update\nt${t1} done\nt${t2} blocked`));

    expect(await statusOf(t1)).toBe("done");
    expect(await statusOf(t2)).toBe("blocked");
  });

  it("a batch with one unknown id reports that item's failure without aborting the rest", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();
    const t2 = await seedTask();
    const bogusId = t2 + 9999;

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/update t${t1} done, t${bogusId} done, t${t2} done`),
    );

    expect(await statusOf(t1)).toBe("done");
    expect(await statusOf(t2)).toBe("done");
    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/2\/3 updated/);
    expect(text).toContain(`t${bogusId} ✗`);
  });

  it("a batch with one unparseable status word reports that item's failure", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();
    const t2 = await seedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update t${t1} done, t${t2} finished`));

    expect(await statusOf(t1)).toBe("done");
    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/1\/2 updated/);
    expect(text).toMatch(/unrecognized status/i);
  });

  it("a batch with a cross-cohort id reports it as not found, without touching the others", async () => {
    const crossRoster = new Roster([
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { username: "alice", role: "Intern", cohortId: COHORT },
      { username: "dave", role: "Intern", cohortId: "other-cohort" },
    ]);
    const crossBot = makeTestBot(crossRoster);
    const higherUpId = nextUserId();
    await registerCaller(crossBot, higherUpId, "carla");

    // A filler task in the *other* cohort, so the real `other` task below
    // lands on an id that cohort-5 (COHORT) never assigns to anything —
    // cohort id sequences are independent, so without this the two
    // cohorts' single tasks would coincidentally share id 1 and the test
    // wouldn't be able to tell a same-cohort hit from a cross-cohort leak.
    await crossBot.service.assignTask(
      { username: "dave", role: "Intern", cohortId: "other-cohort" },
      { assigneeUsername: "dave", title: "filler", description: "d", dueDate: "2026-09-05" },
    );
    const other = await crossBot.service.assignTask(
      { username: "dave", role: "Intern", cohortId: "other-cohort" },
      { assigneeUsername: "dave", title: "not mine", description: "d", dueDate: "2026-09-05" },
    );
    if (!other.ok) throw new Error("setup failed");
    const own = await crossBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "mine", description: "d", dueDate: "2026-09-05" },
    );
    if (!own.ok) throw new Error("setup failed");
    expect(own.value.id).not.toBe(other.value.id);

    await crossBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/update t${own.value.id} done, t${other.value.id} done`),
    );

    const mine = await crossBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      own.value.id,
    );
    expect(mine.ok && mine.value.status).toBe("done");
    const text = lastReplyText(crossBot.calls);
    expect(text).toMatch(/1\/2 updated/);
    expect(text).toMatch(/doesn't exist/);
  });

  it("a wholly-invalid batch replies with usage help, not a wall of identical errors", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/update t9001 done, t9002 done"));

    expect(lastReplyText(testBot.calls)).toMatch(/usage/i);
  });

  it("a single-item batch behaves identically to the non-batch command", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update t${t1} done`));

    expect(lastReplyText(testBot.calls)).toBe(`Task ${t1} set to Done.`);
  });

  it("duplicate refs in one batch are each applied, independently, in order", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/update t${t1} in progress, t${t1} done`),
    );

    expect(await statusOf(t1)).toBe("done");
    expect(lastReplyText(testBot.calls)).toMatch(/2\/2 updated/);
  });

  it("a mid-batch failure leaves the earlier items committed — no batch transaction", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();
    const t2 = await seedTask();

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/update t${t1} done, t${t2} bogus-status`),
    );

    expect(await statusOf(t1)).toBe("done");
  });

  it("a batch large enough to exceed Telegram's 4096-character limit is chunked, not truncated", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const ids: number[] = [];
    for (let i = 0; i < 400; i++) {
      ids.push(await seedTask());
    }
    const line = ids.map((id) => `t${id} done`).join(", ");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update ${line}`));

    for (const id of ids) {
      expect(await statusOf(id)).toBe("done");
    }
    const replies = testBot.calls.filter((c) => c.method === "sendMessage");
    expect(replies.length).toBeGreaterThan(1);
    for (const reply of replies) {
      expect((reply.payload.text as string).length).toBeLessThanOrEqual(4096);
    }
  }, 20000);

  it("a 20-task batch touching one assignee sends that person exactly one DM", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(await seedTask("alice"));
    }
    const line = ids.map((id) => `t${id} done`).join(", ");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update ${line}`));

    const dmsToAlice = testBot.calls.filter(
      (c) => c.method === "sendMessage" && Number(c.payload.chat_id) === aliceId,
    );
    expect(dmsToAlice).toHaveLength(1);
  });

  it("/done and /complete also accept comma-separated ref lists (issue #32)", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const t1 = await seedTask();
    const t2 = await seedTask();
    const t3 = await seedTask();
    const t4 = await seedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/done ${t1},${t2}`));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/complete t${t3}, t${t4}`));

    expect(await statusOf(t1)).toBe("in_review");
    expect(await statusOf(t2)).toBe("in_review");
    expect(await statusOf(t3)).toBe("done");
    expect(await statusOf(t4)).toBe("done");
  });
});

describe("/done and /complete — Devie's deliberate wart (issue #27/#31)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  async function seedTask(): Promise<number> {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Ship it", description: "d", dueDate: "2026-09-05" },
    );
    if (!task.ok) throw new Error("setup failed");
    return task.value.id;
  }

  // Pinned deliberately per issue #27/#31: `/done` sets `in_review` while
  // `/update <ref> done` sets `done`. Both are intended — this test exists
  // so a future reader doesn't "fix" one of them.
  it("/done <ref> sets in_review, NOT done", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/done ${taskId}`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).toBe("in_review");
  });

  it("/complete <ref> sets done", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/complete ${taskId}`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).toBe("done");
  });

  it("/update <ref> done also sets done — distinct from /done's in_review", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/update ${taskId} done`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).toBe("done");
  });
});

describe("/overdue replaces /backlog (issue #27/#31 — no alias retained)", () => {
  it("/overdue lists overdue tasks", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Overdue thing", description: "d", dueDate: "2020-01-01" },
    );
    if (!task.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/overdue"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Overdue thing");
  });

  it("/backlog no longer exists as the overdue-list command — it does not fall through to the generic 'not sure' reply", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/backlog"));

    const text = lastReplyText(testBot.calls);
    expect(text).not.toMatch(/not sure what you mean/i);
    expect(text).toContain("/overdue");
  });

  it("a small number of overdue tasks still sends exactly one message — chunking must not fragment normal-sized replies (issue #55/F8)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const task = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Overdue thing", description: "d", dueDate: "2020-01-01" },
    );
    if (!task.ok) throw new Error("setup failed");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/overdue"));

    const replies = testBot.calls.filter((c) => c.method === "sendMessage");
    expect(replies).toHaveLength(1);
  });
});

describe("Cohort binding closes the reused-account ambiguity (dry-run isolation fix)", () => {
  // ADR-0004: the dry-run cohort reuses the same real Telegram accounts as
  // the real cohort, so "carla"/"alice" exist under both cohort-5 and
  // cohort5-dryrun. Before the fix, /start and every withCaller-wrapped
  // command (resolveCaller -> roster.find(username), no cohort context)
  // would resolve against whichever cohort happened to be first in roster
  // order — silently reading/writing the wrong cohort's tasks. This
  // exercises the actual attack surface: a real bot instance, dispatching
  // real Telegram updates through bot.handleUpdate, exactly as the webhook
  // handler does.
  function ambiguousRoster() {
    return new Roster([
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { username: "alice", role: "Intern", cohortId: COHORT },
      { username: "carla", role: "HigherUp", cohortId: "cohort5-dryrun" },
      { username: "alice", role: "Intern", cohortId: "cohort5-dryrun" },
    ]);
  }

  it("/start registers the caller against this deployment's own bound cohort, not the ambiguous first match", async () => {
    const testBot = makeTestBot(ambiguousRoster(), "cohort5-dryrun");
    const carlaId = nextUserId();
    // messageUpdate's synthetic `from` has no username, but /start reads
    // ctx.from.username directly — build the update by hand here instead
    // of widening the shared helper's shape for every other test.
    const startUpdate = {
      update_id: 900000 + carlaId,
      message: {
        message_id: 900000 + carlaId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: carlaId, type: "private" },
        from: { id: carlaId, is_bot: false, first_name: "Test", username: "carla" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    } as unknown as Update;
    await testBot.bot.handleUpdate(startUpdate);

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("cohort5-dryrun");
    expect(text).not.toContain(`${COHORT}.`); // not "...for cohort-5."
  });

  it("a /assign'd task and a /mytasks read both stay scoped to this deployment's bound cohort, never leaking into the other cohort sharing the same usernames", async () => {
    // Two separate deployments (as if one were the real cohort-5 webhook
    // and the other were the dry-run webhook), sharing nothing but the
    // same ambiguous roster shape — exactly today's live setup.
    const dryRunBot = makeTestBot(ambiguousRoster(), "cohort5-dryrun");
    const realBot = makeTestBot(ambiguousRoster(), COHORT);

    const carlaId = nextUserId();
    const aliceId = nextUserId();
    await registerCaller(dryRunBot, carlaId, "carla");
    await registerCaller(dryRunBot, aliceId, "alice");

    const assignResult = await dryRunBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: "cohort5-dryrun" },
      {
        assigneeUsername: "alice",
        title: "dry-run-only task",
        description: "d",
        dueDate: "2026-09-05",
      },
    );
    if (!assignResult.ok) throw new Error("setup failed");

    await dryRunBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/mytasks"));
    expect(lastReplyText(dryRunBot.calls)).toContain("dry-run-only task");

    // The "real cohort" deployment has its own separate InMemoryTaskStore
    // (a different createBot() call, mirroring two separate deployed
    // instances each with their own SupabaseTaskStore call scoped by
    // cohortId) — same roster, same usernames, zero visibility into the
    // dry-run deployment's task.
    await registerCaller(realBot, aliceId, "alice");
    await realBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/mytasks"));
    expect(lastReplyText(realBot.calls)).not.toContain("dry-run-only task");
  });
});

describe("Stage 1: outermost error-guard middleware (issue #49/#50, finding F1)", () => {
  const ERROR_GUARD_TEXT = "Something went wrong on my end";

  function makeThrowingRegistrationBot(roster: Roster) {
    const { calls, transformer } = makeFakeTransformer();
    const bot = new Bot("TEST_TOKEN", { botInfo: FAKE_BOT_INFO });
    bot.api.config.use(transformer);
    const registrationStore: RegistrationStorePort = {
      register: async () => {},
      findUsername: async () => {
        throw new Error("supabase down");
      },
      findTelegramId: async () => undefined,
    };
    const created = createBot({
      token: "TEST_TOKEN",
      taskStore: new InMemoryTaskStore(),
      registrationStore,
      wizardStateStore: new InMemoryWizardStateStore(),
      activeCohortId: COHORT,
      dashboardUrl: "http://localhost:1234",
      bot,
      roster,
    });
    return { ...created, calls };
  }

  it("a handler that throws produces a reply instead of an escaping error", async () => {
    const roster = makeRoster();
    const testBot = makeThrowingRegistrationBot(roster);
    const userId = nextUserId();

    await expect(
      testBot.bot.handleUpdate(messageUpdate(userId, userId, "/mytasks")),
    ).resolves.toBeUndefined();

    expect(lastReplyText(testBot.calls)).toContain(ERROR_GUARD_TEXT);
  });

  it("does not swallow success: /help still replies and console.error is not called", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const userId = nextUserId();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await testBot.bot.handleUpdate(messageUpdate(userId, userId, "/help"));

    expect(lastReplyText(testBot.calls)).not.toContain(ERROR_GUARD_TEXT);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("a failure inside the reply itself does not escape", async () => {
    const roster = makeRoster();
    const bot = new Bot("TEST_TOKEN", { botInfo: FAKE_BOT_INFO });
    const transformer: Transformer = async (_prev, method) => {
      if (method === "sendMessage") {
        throw new Error("telegram api unreachable");
      }
      return { ok: true, result: true } as never;
    };
    bot.api.config.use(transformer);
    const registrationStore: RegistrationStorePort = {
      register: async () => {},
      findUsername: async () => {
        throw new Error("supabase down");
      },
      findTelegramId: async () => undefined,
    };
    const created = createBot({
      token: "TEST_TOKEN",
      taskStore: new InMemoryTaskStore(),
      registrationStore,
      wizardStateStore: new InMemoryWizardStateStore(),
      activeCohortId: COHORT,
      dashboardUrl: "http://localhost:1234",
      bot,
      roster,
    });
    const userId = nextUserId();

    await expect(
      created.bot.handleUpdate(messageUpdate(userId, userId, "/mytasks")),
    ).resolves.toBeUndefined();
  });
});

describe("Stage 4 (N4): a typo'd command must not destroy an in-progress form (issue #63, finding H6)", () => {
  it("a typo'd command does not cancel the wizard, and the form is still usable", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tsak 3"));

    const replies = testBot.calls
      .filter((c) => c.method === "sendMessage")
      .map((c) => c.payload.text as string);
    expect(replies.some((t) => /cancelled your in-progress form/i.test(t))).toBe(false);
    expect(await testBot.wizards.has(higherUpId)).toBe(true);
  });

  it("after a typo'd command, a valid assignee still advances the form to Title?", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/tsak 3"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "alice"));

    expect(lastReplyText(testBot.calls)).toMatch(/title/i);
  });

  it("a recognized command (/help) still cancels the wizard (regression guard)", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/help"));

    const replies = testBot.calls
      .filter((c) => c.method === "sendMessage")
      .map((c) => c.payload.text as string);
    expect(replies.some((t) => /cancelled your in-progress form/i.test(t))).toBe(true);
  });

  it("a recognized command with an @botname suffix still cancels the wizard", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/help@test_bot"));

    const replies = testBot.calls
      .filter((c) => c.method === "sendMessage")
      .map((c) => c.payload.text as string);
    expect(replies.some((t) => /cancelled your in-progress form/i.test(t))).toBe(true);
  });

  it("a removed-command redirect handler (/submit) still cancels the wizard", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/addtask"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/submit 3"));

    const replies = testBot.calls
      .filter((c) => c.method === "sendMessage")
      .map((c) => c.payload.text as string);
    expect(replies.some((t) => /cancelled your in-progress form/i.test(t))).toBe(true);
  });
});
