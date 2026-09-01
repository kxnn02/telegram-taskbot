import { describe, expect, it } from "vitest";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "../service/taskService.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { DigestBuilder } from "./digestBuilder.js";

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

function makeBuilder(now: Date = NOW) {
  const store = new InMemoryTaskStore();
  const roster = makeRoster();
  const clock = new FixedClock(now);
  const service = new TaskService(store, roster, clock);
  const builder = new DigestBuilder({ service, roster });
  return { builder, service, roster };
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

describe("DigestBuilder.internDigest", () => {
  it("returns null (suppressed) when the intern has no open tasks", async () => {
    const { builder } = makeBuilder();
    expect(await builder.internDigest("alice", COHORT)).toBeNull();
  });

  it("returns digest text when the intern has open tasks", async () => {
    const { builder, service } = makeBuilder();
    await assign(service);
    const text = await builder.internDigest("alice", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain("onboarding doc");
  });
});

describe("DigestBuilder.higherUpDailyDigest", () => {
  it("returns null (suppressed) when there's nothing pending/blocked/overdue", async () => {
    const { builder } = makeBuilder();
    expect(await builder.higherUpDailyDigest("dave", COHORT)).toBeNull();
  });

  it("includes pending-review tasks", async () => {
    const { builder, service } = makeBuilder();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "in_review");
    const text = await builder.higherUpDailyDigest("dave", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain(`#${created.value.id}`);
  });

  it("includes blocked tasks even if not overdue or pending", async () => {
    const { builder, service } = makeBuilder();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setBlocked(alice, created.value.id, "stuck on access");
    const text = await builder.higherUpDailyDigest("dave", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain("stuck on access");
  });

  it("includes overdue tasks", async () => {
    const past = new Date("2026-09-20T02:00:00.000Z"); // after 2026-09-10 due date
    const { builder, service } = makeBuilder(past);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const text = await builder.higherUpDailyDigest("dave", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain(`#${created.value.id}`);
  });
});

describe("DigestBuilder.higherUpWeeklyDigest", () => {
  it("returns null (suppressed) when nothing pending and nothing approved recently", async () => {
    const { builder } = makeBuilder();
    expect(await builder.higherUpWeeklyDigest("dave", COHORT, NOW)).toBeNull();
  });

  it("includes tasks approved within the past week", async () => {
    const { builder, service } = makeBuilder();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "in_review");
    await service.setStatus(carla, created.value.id, "done");
    const text = await builder.higherUpWeeklyDigest("dave", COHORT, NOW);
    expect(text).not.toBeNull();
    expect(text).toContain(`#${created.value.id}`);
  });

  it("excludes tasks approved more than a week ago", async () => {
    const longAgo = new Date("2026-08-01T02:00:00.000Z");
    const { builder, service } = makeBuilder(longAgo);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "in_review");
    await service.setStatus(carla, created.value.id, "done");
    const text = await builder.higherUpWeeklyDigest("dave", COHORT, NOW); // NOW is a month later
    expect(text).toBeNull();
  });
});

describe("DigestBuilder.groupDailyCounts", () => {
  it("aggregates on-track/overdue/blocked counts per intern", async () => {
    const { builder, service } = makeBuilder();
    await assign(service, { assigneeUsername: "alice" });
    await assign(service, { assigneeUsername: "bob", dueDate: "2026-09-01" }); // overdue relative to NOW

    const counts = await builder.groupDailyCounts(COHORT);
    const aliceCounts = counts.find((c) => c.username === "alice");
    const bobCounts = counts.find((c) => c.username === "bob");
    expect(aliceCounts).toEqual({ username: "alice", onTrack: 1, overdue: 0, blocked: 0 });
    expect(bobCounts).toEqual({ username: "bob", onTrack: 0, overdue: 1, blocked: 0 });
  });

  it("gives a zeroed line for an intern with no tasks at all", async () => {
    const { builder, service } = makeBuilder();
    await assign(service, { assigneeUsername: "alice" });
    const counts = await builder.groupDailyCounts(COHORT);
    const bobCounts = counts.find((c) => c.username === "bob");
    expect(bobCounts).toEqual({ username: "bob", onTrack: 0, overdue: 0, blocked: 0 });
  });

  it("includes a HigherUp holding a task — assignment isn't intern-only (issue #27/#29)", async () => {
    const { builder, service } = makeBuilder();
    await assign(service, { assigneeUsername: "dave" });
    const counts = await builder.groupDailyCounts(COHORT);
    const daveCounts = counts.find((c) => c.username === "dave");
    expect(daveCounts).toEqual({ username: "dave", onTrack: 1, overdue: 0, blocked: 0 });
  });
});
