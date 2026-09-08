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
    description: "Draft the onboarding checklist",
    dueDate: "2026-09-10",
    ...overrides,
  });
}

describe("DigestBuilder.ownTasksDigest", () => {
  it("returns null (suppressed) when the member has no open tasks", async () => {
    const { builder } = makeBuilder();
    expect(await builder.ownTasksDigest("alice", COHORT)).toBeNull();
  });

  it("returns digest text when the member has open tasks", async () => {
    const { builder, service } = makeBuilder();
    await assign(service);
    const text = await builder.ownTasksDigest("alice", COHORT);
    expect(text).not.toBeNull();
    expect(text).toContain("onboarding doc");
  });
});

describe("DigestBuilder.weeklyDigest (#143 D4b / #147)", () => {
  it("returns null (suppressed) when the member completed nothing this week", async () => {
    const { builder, service } = makeBuilder();
    await assign(service); // open task — not completed
    expect(await builder.weeklyDigest("alice", COHORT, NOW)).toBeNull();
  });

  it("returns completed-this-week digest text when the member completed a task", async () => {
    const { builder, service } = makeBuilder();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "done");

    const text = await builder.weeklyDigest("alice", COHORT, NOW);
    expect(text).not.toBeNull();
    expect(text).toContain("onboarding doc");
    expect(text).toContain("Completed this week");
  });

  it("excludes a task completed more than 7 days before `now`", async () => {
    const { builder, service } = makeBuilder(NOW);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "done");

    // 8 days after NOW — outside the trailing-7-day window measured from it.
    const later = new Date("2026-09-12T02:00:00.000Z");
    expect(await builder.weeklyDigest("alice", COHORT, later)).toBeNull();
  });

  it("does not include another member's completed task", async () => {
    const { builder, service } = makeBuilder();
    const created = await assign(service, { assigneeUsername: "bob", title: "Ship release notes" });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(caller("bob"), created.value.id, "done");

    expect(await builder.weeklyDigest("alice", COHORT, NOW)).toBeNull();
    const bobText = await builder.weeklyDigest("bob", COHORT, NOW);
    expect(bobText).toContain("Ship release notes");
  });
});

