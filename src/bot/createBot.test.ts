import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot, InlineKeyboard, type Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { Roster } from "../domain/roster.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryWizardStateStore } from "../storage/inMemoryWizardStateStore.js";
import { createBot, type CreatedBot } from "./createBot.js";

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

function makeFakeTransformer() {
  const calls: RecordedCall[] = [];
  let messageId = 1000;
  const transformer: Transformer = async (_prev, method, payload) => {
    calls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
    const p = (payload ?? {}) as Record<string, unknown>;
    if (method === "sendMessage" || method === "editMessageText") {
      return {
        ok: true,
        result: {
          message_id: (p.message_id as number) ?? messageId++,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(p.chat_id) || 1, type: "private" },
          text: (p.text as string) ?? "",
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
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "in 3 days"));

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

describe("/canceltask confirm callback retargets to the free-set status model (#28)", () => {
  it("confirming cancellation sets the task's status to backlog, not a removed Cancelled status", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const assignResult = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Task to cancel",
        description: "Some description",
        dueDate: "2026-09-05",
      },
    );
    if (!assignResult.ok) throw new Error("setup failed: " + assignResult.error);
    const taskId = assignResult.value.id;

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/canceltask ${taskId}`),
    );
    await testBot.bot.handleUpdate(
      callbackUpdate(higherUpId, higherUpId, `canceltask:yes:${taskId}`),
    );

    const getResult = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value.status).toBe("backlog");
    }
  });

  it("declining the confirmation ('No') leaves the task's status unchanged", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const assignResult = await testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Task to keep",
        description: "Some description",
        dueDate: "2026-09-05",
      },
    );
    if (!assignResult.ok) throw new Error("setup failed: " + assignResult.error);
    const taskId = assignResult.value.id;

    await testBot.bot.handleUpdate(
      messageUpdate(higherUpId, higherUpId, `/canceltask ${taskId}`),
    );
    await testBot.bot.handleUpdate(
      callbackUpdate(higherUpId, higherUpId, `canceltask:no:${taskId}`),
    );

    const getResult = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value.status).toBe("todo");
    }
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

  it("the existing /unblocked <task_id> typed command still works unchanged", async () => {
    const { taskId, higherUpId } = await seedBlockedTask();

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/unblocked ${taskId}`));

    const result = await testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.status).not.toBe("blocked");
    expect(lastReplyText(testBot.calls)).toMatch(/no longer blocked/i);
  });
});

describe("/task <id> appends a per-status next-step hint (issue #27/#29)", () => {
  it("hints at /submit for a todo task", async () => {
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
    expect(text).toMatch(/\/submit/);
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

    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, `/submit ${task.value.id}`));

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

    await testBot.bot.handleUpdate(messageUpdate(bobId, bobId, `/approve ${task.value.id}`));

    const dms = sentDMs(bobId);
    expect(dms.filter((id) => id === String(carlaId))).toHaveLength(1);
  });
});

describe("/alltasks and /mytasks pagination (issue #7)", () => {
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

  it("/alltasks with a small result set shows no pagination footer", async () => {
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
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/alltasks"));

    const text = lastReplyText(testBot.calls);
    expect(text).not.toMatch(/Page \d+ of \d+/);
    expect(text).toContain("@alice:");
  });

  it("/alltasks paginates and preserves grouping by assignee within a page", async () => {
    await assignEleven();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/alltasks 2"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("@alice:");
    expect(text).toContain("#11");
  });

  it("/mytasks with a non-numeric page argument gets a usage message", async () => {
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/mytasks abc"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/usage/i);
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
