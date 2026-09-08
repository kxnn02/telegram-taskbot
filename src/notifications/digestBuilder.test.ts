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

