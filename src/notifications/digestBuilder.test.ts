import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/schema.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "../service/taskService.js";
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
  const db = openDatabase(":memory:");
  const roster = makeRoster();
  const clock = new FixedClock(now);
  const service = new TaskService(db, roster, clock);
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
  it("returns null (suppressed) when the intern has no open tasks", () => {
    const { builder } = makeBuilder();
    expect(builder.internDigest("alice", COHORT)).toBeNull();
  });

  it("returns digest text when the intern has open tasks", () => {
    const { builder, service } = makeBuilder();
    assign(service);
    const text = builder.internDigest("alice", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain("onboarding doc");
  });
});

describe("DigestBuilder.higherUpDailyDigest", () => {
  it("returns null (suppressed) when there's nothing pending/blocked/overdue", () => {
    const { builder } = makeBuilder();
    expect(builder.higherUpDailyDigest("dave", COHORT)).toBeNull();
  });

  it("includes pending-review tasks", () => {
    const { builder, service } = makeBuilder();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    service.submitTask(alice, created.value.id);
    const text = builder.higherUpDailyDigest("dave", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain(`#${created.value.id}`);
  });

  it("includes blocked tasks even if not overdue or pending", () => {
    const { builder, service } = makeBuilder();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    service.setBlocked(alice, created.value.id, "stuck on access");
    const text = builder.higherUpDailyDigest("dave", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain("stuck on access");
  });

  it("includes overdue tasks", () => {
    const past = new Date("2026-09-20T02:00:00.000Z"); // after 2026-09-10 due date
    const { builder, service } = makeBuilder(past);
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const text = builder.higherUpDailyDigest("dave", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain(`#${created.value.id}`);
  });
});

describe("DigestBuilder.higherUpWeeklyDigest", () => {
  it("returns null (suppressed) when nothing pending and nothing approved recently", () => {
    const { builder } = makeBuilder();
    expect(builder.higherUpWeeklyDigest("dave", COHORT, NOW)).toBeNull();
  });

  it("includes tasks approved within the past week", () => {
    const { builder, service } = makeBuilder();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    service.submitTask(alice, created.value.id);
    service.approveTask(carla, created.value.id);
    const text = builder.higherUpWeeklyDigest("dave", COHORT, NOW);
    expect(text).not.toBeNull();
    expect(text).toContain(`#${created.value.id}`);
  });

  it("excludes tasks approved more than a week ago", () => {
    const longAgo = new Date("2026-08-01T02:00:00.000Z");
    const { builder, service } = makeBuilder(longAgo);
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    service.submitTask(alice, created.value.id);
    service.approveTask(carla, created.value.id);
    const text = builder.higherUpWeeklyDigest("dave", COHORT, NOW); // NOW is a month later
    expect(text).toBeNull();
  });
});

describe("DigestBuilder.groupDailyCounts", () => {
  it("aggregates on-track/overdue/blocked counts per intern", () => {
    const { builder, service } = makeBuilder();
    assign(service, { assigneeUsername: "alice" });
    assign(service, { assigneeUsername: "bob", dueDate: "2026-09-01" }); // overdue relative to NOW

    const counts = builder.groupDailyCounts(COHORT);
    const aliceCounts = counts.find((c) => c.username === "alice");
    const bobCounts = counts.find((c) => c.username === "bob");
    expect(aliceCounts).toEqual({ username: "alice", onTrack: 1, overdue: 0, blocked: 0 });
    expect(bobCounts).toEqual({ username: "bob", onTrack: 0, overdue: 1, blocked: 0 });
  });

  it("gives a zeroed line for an intern with no tasks at all", () => {
    const { builder, service } = makeBuilder();
    assign(service, { assigneeUsername: "alice" });
    const counts = builder.groupDailyCounts(COHORT);
    const bobCounts = counts.find((c) => c.username === "bob");
    expect(bobCounts).toEqual({ username: "bob", onTrack: 0, overdue: 0, blocked: 0 });
  });
});
