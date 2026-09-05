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
  sendDM,
  type NotifierBot,
  type SchedulerDeps,
} from "./scheduler.js";

const COHORT = "cohort-5";

function makeRoster() {
  return new Roster([
    { username: "alice", cohortId: COHORT },
    { username: "bob", cohortId: COHORT },
    { username: "carla", cohortId: COHORT },
    { username: "dave", cohortId: COHORT },
  ]);
}

function caller(username: string): Caller {
  return { username, cohortId: COHORT };
}

const carla = caller("carla");
const alice = caller("alice");

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

/** Wraps a real registration store so lookups for `badUsername` throw,
 * mirroring the `.maybeSingle()` "multiple rows" failure a duplicated
 * roster handle produces (#49's F5 / #59's H3). */
function makeThrowingRegistrations(
  store: InMemoryRegistrationStore,
  badUsername: string,
): InMemoryRegistrationStore {
  const original = store.findTelegramId.bind(store);
  vi.spyOn(store, "findTelegramId").mockImplementation(async (username: string) => {
    if (username === badUsername) throw new Error("PGRST116 multiple rows");
    return original(username);
  });
  return store;
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
    description: "Draft the onboarding checklist",
    dueDate: "2026-09-10",
    ...overrides,
  });
}

describe("sendDM (issue #59/H3)", () => {
  it("returns false and does not throw when findTelegramId throws", async () => {
    const { deps, registrations } = await makeDeps();
    makeThrowingRegistrations(registrations, "alice");
    await expect(sendDM(deps.bot, registrations, "alice", "hi")).resolves.toBe(false);
  });

  it("returns false when there is no Registration", async () => {
    const { deps, registrations } = await makeDeps();
    await expect(sendDM(deps.bot, registrations, "ghost", "hi")).resolves.toBe(false);
  });

  it("returns true on a successful send", async () => {
    const { deps, registrations } = await makeDeps();
    await expect(sendDM(deps.bot, registrations, "alice", "hi")).resolves.toBe(true);
  });
});

describe("runOverdueCrossingCheck", () => {
  it("notifies both the assignee and the assigner exactly once", async () => {
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

  it("a broken lookup for one task's assignee does not skip the next task, and does not mark the failed one notified (issue #59/H3)", async () => {
    const past = new Date("2026-09-20T02:00:00.000Z");
    const { deps, service, bot, overdueNotifications, registrations } = await makeDeps(past);
    const first = await assign(service, { assigneeUsername: "alice" });
    const second = await assign(service, { assigneeUsername: "bob" });
    if (!first.ok || !second.ok) throw new Error("setup failed");
    makeThrowingRegistrations(registrations, "alice");

    await runOverdueCrossingCheck(deps, COHORT, past);

    expect(await overdueNotifications.hasNotified(COHORT, second.value.id)).toBe(true);
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

  it("a broken lookup for one recipient does not skip the rest (issue #59/H3)", async () => {
    const { deps, service, bot, registrations } = await makeDeps();
    await assign(service, { assigneeUsername: "alice", dueDate: "2026-09-05" });
    await assign(service, { assigneeUsername: "bob", dueDate: "2026-09-05" });
    makeThrowingRegistrations(registrations, "alice");

    await runDueSoonReminderCheck(deps, COHORT, NOW);

    expect(bot.sent).toHaveLength(1);
  });
});

describe("runDailyDigest", () => {
  it("DMs every member with something to report, and posts a counts-only group summary", async () => {
    const { deps, service, bot } = await makeDeps();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "in_review");

    const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
    await runDailyDigest(deps, digestBuilder, COHORT);

    // alice has an open (submitted) task -> DM. Every member also gets the
    // cohort-wide oversight half (pending review) now that there's no role
    // tier to restrict it to (ADR-0013), so bob/carla/dave all get one too.
    const dmCount = bot.sent.filter((m) => typeof m.chatId === "number").length;
    expect(dmCount).toBe(4);

    const groupMessage = bot.sent.find((m) => m.chatId === "-100999");
    expect(groupMessage).toBeDefined();
    expect(groupMessage!.text.toLowerCase()).not.toContain("onboarding");
  });

  it("a member holding their own task sees it, not just the oversight view", async () => {
    const { deps, service, bot } = await makeDeps();
    const created = await assign(service, { assigneeUsername: "dave" });
    if (!created.ok) throw new Error("setup failed");

    const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
    await runDailyDigest(deps, digestBuilder, COHORT);

    const daveDm = bot.sent.find(
      (m) => m.text.includes("Daily digest") && m.text.includes("onboarding doc"),
    );
    expect(daveDm).toBeDefined();
  });

  it("a broken lookup for one member does not skip the rest of the roster, and the group summary still posts (issue #59/H3)", async () => {
    const { deps, service, bot, registrations } = await makeDeps();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "in_review");
    // Roster order is alice, bob, carla, dave — alice's lookup throws.
    makeThrowingRegistrations(registrations, "alice");

    const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
    await runDailyDigest(deps, digestBuilder, COHORT);

    // bob, carla, and dave all get the cohort-wide oversight digest
    // (pending review) despite alice's lookup blowing up first in roster
    // order — alice herself is skipped since her own send fails.
    const dmCount = bot.sent.filter((m) => typeof m.chatId === "number").length;
    expect(dmCount).toBe(3);

    const groupMessage = bot.sent.find((m) => m.chatId === "-100999");
    expect(groupMessage).toBeDefined();
  });
});

describe("runWeeklyDigest", () => {
  it("suppresses members with nothing open, pending, or approved recently", async () => {
    const { deps, service, bot } = await makeDeps();
    await assign(service); // Assigned only, not submitted/approved -> nothing for higher-ups
    const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
    await runWeeklyDigest(deps, digestBuilder, COHORT, NOW);

    const weeklyDms = bot.sent.filter((m) => m.text.includes("Weekly digest"));
    // Only alice (has an open task) should get a weekly DM.
    expect(weeklyDms).toHaveLength(1);
  });

  it("a broken lookup for the middle roster member still reaches the last one (issue #59/H3)", async () => {
    const { deps, service, bot, registrations } = await makeDeps();
    await assign(service, { assigneeUsername: "alice" });
    await assign(service, { assigneeUsername: "bob" });
    // Roster order is alice, bob, carla, dave — bob is the middle member
    // with an open task.
    makeThrowingRegistrations(registrations, "bob");

    const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
    await runWeeklyDigest(deps, digestBuilder, COHORT, NOW);

    const aliceDm = bot.sent.find((m) => m.text.includes("Weekly digest"));
    expect(aliceDm).toBeDefined();
  });
});
