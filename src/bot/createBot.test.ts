import { beforeEach, describe, expect, it } from "vitest";
import { Bot, InlineKeyboard, type Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { Roster } from "../domain/roster.js";
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

function makeTestBot(roster: Roster) {
  const { calls, transformer } = makeFakeTransformer();
  const bot = new Bot("TEST_TOKEN", { botInfo: FAKE_BOT_INFO });
  bot.api.config.use(transformer);
  const created = createBot({
    token: "TEST_TOKEN",
    dbPath: ":memory:",
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
  created.registrations.register(userId, username);
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
    const result = testBot.service.assignTask(
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

    const result = testBot.service.getTask(
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

    let result = testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.dueDate).toBe("2026-09-05"); // unchanged so far

    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "duedate:yes"));

    result = testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dueDate).not.toBe("2026-09-05");
      expect(result.value.title).toBe("Original title"); // untouched
    }
  });

  it("tapping Assignee with a non-intern username is rejected with the known-intern error", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    await testBot.bot.handleUpdate(callbackUpdate(higherUpId, higherUpId, "editfield:assignee"));
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "carla")); // higher-up, not intern

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/isn't a known intern/i);

    const result = testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      taskId,
    );
    expect(result.ok && result.value.assigneeUsername).toBe("alice"); // unchanged
  });

  it("/edit on an Approved task is rejected before the menu shows", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    const alice = { username: "alice", role: "Intern" as const, cohortId: COHORT };
    const carla = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    testBot.service.submitTask(alice, taskId);
    testBot.service.approveTask(carla, taskId);

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/approved/i);
    expect(text).not.toContain("Which field");
    expect(testBot.wizards.has(higherUpId)).toBe(false);
  });

  it("/cancel aborts the wizard at the field-choice stage", async () => {
    const taskId = await seedTask();
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, `/edit ${taskId}`));
    expect(testBot.wizards.has(higherUpId)).toBe(true);
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/cancel"));
    expect(testBot.wizards.has(higherUpId)).toBe(false);

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/cancelled/i);
  });
});

describe("/assign full 4-step flow (regression, unaffected by /edit changes)", () => {
  it("walks assignee -> title -> description -> due date -> confirm -> creates the task", async () => {
    const roster = makeRoster();
    const testBot = makeTestBot(roster);
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");

    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/assign"));
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

    const list = testBot.service.listAllTasks({
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
});

describe("/blocked (no arguments): read-only blocked list, issue #6", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  it("a higher-up sees every blocked task in the cohort, with assignee shown", async () => {
    const aliceTask = testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft it",
        dueDate: "2026-09-05",
      },
    );
    if (!aliceTask.ok) throw new Error("setup failed");
    testBot.service.setBlocked(
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

  it("an intern sees only their own blocked tasks, not another intern's", async () => {
    const aliceTask = testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft it",
        dueDate: "2026-09-05",
      },
    );
    const bobTask = testBot.service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      {
        assigneeUsername: "bob",
        title: "Set up CI",
        description: "Configure it",
        dueDate: "2026-09-05",
      },
    );
    if (!aliceTask.ok || !bobTask.ok) throw new Error("setup failed");
    testBot.service.setBlocked(
      { username: "alice", role: "Intern", cohortId: COHORT },
      aliceTask.value.id,
      "waiting on API access",
    );
    testBot.service.setBlocked(
      { username: "bob", role: "Intern", cohortId: COHORT },
      bobTask.value.id,
      "waiting on design review",
    );

    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/blocked"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain(`#${aliceTask.value.id}`);
    expect(text).not.toContain(`#${bobTask.value.id}`);
    expect(text).not.toContain("design review");
  });

  it("a caller with zero blocked tasks gets a clear 'nothing blocked' message", async () => {
    const higherUpId = nextUserId();
    await registerCaller(testBot, higherUpId, "carla");
    await testBot.bot.handleUpdate(messageUpdate(higherUpId, higherUpId, "/blocked"));

    const text = lastReplyText(testBot.calls);
    expect(text).toMatch(/nothing.*blocked/i);
  });

  it("/blocked <id> <reason> still flags a task as blocked (regression: shared command name)", async () => {
    const aliceTask = testBot.service.assignTask(
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

    const result = testBot.service.getTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      aliceTask.value.id,
    );
    expect(result.ok && result.value.blocked).toBe(true);
  });
});

describe("/alltasks and /mytasks pagination (issue #7)", () => {
  let roster: Roster;
  let testBot: ReturnType<typeof makeTestBot>;

  beforeEach(() => {
    roster = makeRoster();
    testBot = makeTestBot(roster);
  });

  function assignEleven() {
    for (let i = 1; i <= 11; i++) {
      const result = testBot.service.assignTask(
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
    assignEleven();
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
    assignEleven();
    const aliceId = nextUserId();
    await registerCaller(testBot, aliceId, "alice");
    await testBot.bot.handleUpdate(messageUpdate(aliceId, aliceId, "/mytasks 2"));

    const text = lastReplyText(testBot.calls);
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("#11");
  });

  it("/alltasks with a small result set shows no pagination footer", async () => {
    const result = testBot.service.assignTask(
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
    assignEleven();
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
