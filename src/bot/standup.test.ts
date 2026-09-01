import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "../service/taskService.js";
import { formatGroupDailySummary } from "../notifications/digestFormat.js";
import type { InternDailyCounts } from "../notifications/digestFormat.js";
import { buildStandup, formatStandup } from "./standup.js";

const COHORT = "cohort-5";

function makeRoster() {
  return new Roster([
    { username: "carla", role: "HigherUp", cohortId: COHORT },
    { username: "alice", role: "Intern", cohortId: COHORT },
    { username: "bob", role: "Intern", cohortId: COHORT },
  ]);
}

const carla: Caller = { username: "carla", role: "HigherUp", cohortId: COHORT };
const alice: Caller = { username: "alice", role: "Intern", cohortId: COHORT };

function makeService() {
  const store = new InMemoryTaskStore();
  const roster = makeRoster();
  const clock = new FixedClock(new Date("2026-08-31T02:00:00.000Z"));
  return { service: new TaskService(store, roster, clock), roster };
}

describe("buildStandup (issue #33)", () => {
  it("includes every roster member in the cohort, even ones with no tasks", async () => {
    const { service, roster } = makeService();
    const entries = await buildStandup(service, roster, carla);
    expect(entries.map((e) => e.username).sort()).toEqual(["alice", "bob", "carla"]);
  });

  it("groups each member's non-done tasks under their entry, with titles", async () => {
    const { service, roster } = makeService();
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      dueDate: "2026-09-05",
    });
    const entries = await buildStandup(service, roster, carla);
    const aliceEntry = entries.find((e) => e.username === "alice");
    expect(aliceEntry?.tasks.map((t) => t.title)).toEqual(["Write the onboarding doc"]);
  });

  it("excludes done tasks", async () => {
    const { service, roster } = makeService();
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "finished thing",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "done");
    const entries = await buildStandup(service, roster, carla);
    const aliceEntry = entries.find((e) => e.username === "alice");
    expect(aliceEntry?.tasks).toEqual([]);
  });
});

describe("formatStandup (issue #33 — must not reuse the digest's title-free formatter or type)", () => {
  it("may include task titles, unlike the counts-only digest", async () => {
    const { service, roster } = makeService();
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      dueDate: "2026-09-05",
    });
    const entries = await buildStandup(service, roster, carla);
    const text = formatStandup(entries);
    expect(text).toContain("Write the onboarding doc");
  });

  it("says no open tasks for a member with none", () => {
    const text = formatStandup([{ username: "alice", tasks: [] }]);
    expect(text).toContain("@alice: no open tasks");
  });

  it("says nothing to report when the cohort has no roster members", () => {
    expect(formatStandup([])).toMatch(/no roster members/i);
  });

  it("is a distinct formatter from the digest's formatGroupDailySummary", () => {
    expect(formatStandup).not.toBe(formatGroupDailySummary as unknown as typeof formatStandup);
  });

  it("standup's own type carries a task title field the digest's InternDailyCounts structurally has no room for", () => {
    // InternDailyCounts is counts-only: username/onTrack/overdue/blocked, no title field.
    const digestShape: InternDailyCounts = { username: "alice", onTrack: 1, overdue: 0, blocked: 0 };
    expect(Object.keys(digestShape)).not.toContain("tasks");
  });
});
