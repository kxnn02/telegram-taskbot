import { describe, expect, it, vi } from "vitest";
import { InMemoryOverdueNotificationStore } from "../storage/inMemoryOverdueNotificationStore.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryCohortStore } from "../storage/inMemoryCohortStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "../service/taskService.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { DigestBuilder } from "./digestBuilder.js";
import {
  runDailyDigest,
  runDueSoonReminderCheck,
  runOverdueCrossingCheck,
  runWeeklyDigest,
  type NotifierBot,
  type SchedulerDeps,
} from "./scheduler.js";

const COHORT = "cohort-5";

function makeRoster() {
  return new Roster([
    { username: "alice", role: "Intern", cohortId: COHORT },
    { username: "bob", role: "Intern", cohortId: COHORT },
    { username: "carla", role: "HigherUp", cohortId: COHORT },
    { username: "dave", role: "HigherUp", cohortId: COHORT },
  ]);
}

function caller(username: string, role: "Intern" | "HigherUp"): Caller {
  return { username, role, cohortId: COHORT };
}

const carla = caller("carla", "HigherUp");
const alice = caller("alice", "Intern");

// 2026-09-04 10:00 Asia/Manila
const NOW = new Date("2026-09-04T02:00:00.000Z");

function makeFakeBot(): NotifierBot & { sent: Array<{ chatId: number | string; text: string }> } {
  const sent: Array<{ chatId: number | string; text: string }> = [];
  return {
    sent,
    api: {
      sendMessage: vi.fn(async (chatId: number | string, text: string) => {
        sent.push({ chatId, text });
      }),
    },
  };
}

async function makeDeps(now: Date = NOW) {
  const roster = makeRoster();
  const clock = new FixedClock(now);
  const service = new TaskService(new InMemoryTaskStore(), roster, clock);
  const registrations = new InMemoryRegistrationStore();
  const overdueNotifications = new InMemoryOverdueNotificationStore();
  const bot = makeFakeBot();

  // Register everyone so DMs can be delivered (mirrors /start, PRD §7).
  let nextTelegramId = 1000;
  for (const entry of roster.all()) {
    await registrations.register(nextTelegramId++, entry.username);
  }

  const deps: SchedulerDeps = {
    bot,
    registrations,
    service,
    roster,
    overdueNotifications,
    cohorts: new InMemoryCohortStore({ [COHORT]: "-100999" }),
  };
  return { deps, service, roster, bot, overdueNotifications, registrations };
}

function assign(
  service: TaskService,
  overrides: Partial<{
    assigneeUsername: string;
    title: string;
    description: string;
    dueDate: string;
  }> = {},
) {
  return service.assignTask(carla, {
    assigneeUsername: "alice",
    title: "Write the onboarding doc",
    description: "Draft the intern onboarding checklist",
    dueDate: "2026-09-10",
    ...overrides,
  });
}

describe("runOverdueCrossingCheck", () => {
  it("notifies both the intern and the assigning higher-up exactly once", async () => {
    const past = new Date("2026-09-20T02:00:00.000Z"); // after 2026-09-10 due date
    const { deps, service, bot, overdueNotifications } = await makeDeps(past);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");

    await runOverdueCrossingCheck(deps, COHORT, past);

    const recipients = bot.sent.map((m) => m.text);
    expect(recipients).toHaveLength(2);
    expect(await overdueNotifications.hasNotified(COHORT, created.value.id)).toBe(true);

    // Running it again must not re-notify (PRD §8: exactly once per task).
    bot.sent.length = 0;
    await runOverdueCrossingCheck(deps, COHORT, past);
    expect(bot.sent).toHaveLength(0);
  });

  it("doesn't notify for a task that isn't overdue yet", async () => {
    const { deps, service, bot } = await makeDeps();
    await assign(service); // due 2026-09-10, NOW is 2026-09-04
    await runOverdueCrossingCheck(deps, COHORT, NOW);
    expect(bot.sent).toHaveLength(0);
  });
});

describe("runDueSoonReminderCheck", () => {
  it("reminds the assignee of a task due tomorrow", async () => {
    const { deps, service, bot } = await makeDeps();
    await assign(service, { dueDate: "2026-09-05" }); // tomorrow relative to NOW
    await runDueSoonReminderCheck(deps, COHORT, NOW);
    expect(bot.sent).toHaveLength(1);
    expect(bot.sent[0]?.text).toContain("Task");
  });

  it("doesn't remind for a task due further out", async () => {
    const { deps, service, bot } = await makeDeps();
    await assign(service, { dueDate: "2026-09-20" });
    await runDueSoonReminderCheck(deps, COHORT, NOW);
    expect(bot.sent).toHaveLength(0);
  });
});

describe("runDailyDigest", () => {
  it("DMs interns and higher-ups with something to report, and posts a counts-only group summary", async () => {
    const { deps, service, bot } = await makeDeps();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.submitTask(alice, created.value.id);

    const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
    await runDailyDigest(deps, digestBuilder, COHORT);

    // alice has an open (submitted) task -> DM; dave/carla have a pending
    // review -> DM each; bob has nothing -> suppressed.
    const dmCount = bot.sent.filter((m) => typeof m.chatId === "number").length;
    expect(dmCount).toBe(3);

    const groupMessage = bot.sent.find((m) => m.chatId === "-100999");
    expect(groupMessage).toBeDefined();
    expect(groupMessage!.text.toLowerCase()).not.toContain("onboarding");
  });
});

describe("runWeeklyDigest", () => {
  it("suppresses higher-ups with nothing pending and nothing approved recently", async () => {
    const { deps, service, bot } = await makeDeps();
    await assign(service); // Assigned only, not submitted/approved -> nothing for higher-ups
    const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
    await runWeeklyDigest(deps, digestBuilder, COHORT, NOW);

    const higherUpDms = bot.sent.filter((m) => m.text.includes("Weekly digest"));
    // Only alice (intern, has an open task) should get a weekly DM.
    expect(higherUpDms).toHaveLength(1);
  });
});
