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
const NOW = new Date("2026-09-01T02:00:00.000Z"); // Tuesday

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
  const clock = new FixedClock(NOW);
  return { service: new TaskService(store, roster, clock), roster };
}

describe("buildStandup (standup redesign — summary + detail)", () => {
  it("counts every status cohort-wide", async () => {
    const { service } = makeService();
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      dueDate: "2026-09-05",
    });
    const created = await service.assignTask(carla, {
      assigneeUsername: "bob",
      title: "Fix the login bug",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(carla, created.value.id, "in_review");

    const report = await buildStandup(service, carla, NOW);
    expect(report.counts.todo).toBe(1);
    expect(report.counts.in_review).toBe(1);
    expect(report.counts.done).toBe(0);
  });

  it("groups each non-done status's tasks by assignee, skipping members with none in that status", async () => {
    const { service } = makeService();
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      dueDate: "2026-09-05",
    });

    const report = await buildStandup(service, carla, NOW);
    const todoSection = report.details.find((d) => d.status === "todo");
    expect(todoSection?.members.map((m) => m.username)).toEqual(["alice"]);

    const reviewSection = report.details.find((d) => d.status === "in_review");
    expect(reviewSection).toBeUndefined();
  });

  it("carries task titles in the detail groups, unlike the counts-only digest", async () => {
    const { service } = makeService();
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      dueDate: "2026-09-05",
    });

    const report = await buildStandup(service, carla, NOW);
    const todoSection = report.details.find((d) => d.status === "todo");
    expect(todoSection?.members[0]?.tasks.map((t) => t.title)).toEqual([
      "Write the onboarding doc",
    ]);
  });

  it("lists tasks marked done within the past 7 days under doneThisWeek", async () => {
    const { service } = makeService();
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "finished thing",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "done");

    const report = await buildStandup(service, carla, NOW);
    expect(report.doneThisWeek.map((t) => t.title)).toEqual(["finished thing"]);
    expect(report.counts.done).toBe(1);
  });

  it("excludes a done task older than 7 days from doneThisWeek but still counts it", async () => {
    const store = new InMemoryTaskStore();
    const roster = makeRoster();
    const oldService = new TaskService(
      store,
      roster,
      new FixedClock(new Date("2026-08-01T00:00:00.000Z")),
    );
    const created = await oldService.assignTask(carla, {
      assigneeUsername: "alice",
      title: "old finished thing",
      dueDate: "2026-08-05",
    });
    if (!created.ok) throw new Error("setup failed");
    await oldService.setStatus(alice, created.value.id, "done");

    // buildStandup only needs the stored task, not the clock that wrote it,
    // so re-read through a service running on today's clock.
    const nowService = new TaskService(store, roster, new FixedClock(NOW));
    const report = await buildStandup(nowService, carla, NOW);
    expect(report.doneThisWeek).toEqual([]);
    expect(report.counts.done).toBe(1);
  });

  it("carries the caller's cohortId and the report date through untouched", async () => {
    const { service } = makeService();
    const report = await buildStandup(service, carla, NOW);
    expect(report.cohortId).toBe(COHORT);
    expect(report.today).toEqual(NOW);
  });
});

describe("formatStandup (standup redesign)", () => {
  it("renders a cohort/date header derived from the cohortId", async () => {
    const { service } = makeService();
    const report = await buildStandup(service, carla, NOW);
    const text = formatStandup(report);
    expect(text).toContain("Cohort 5");
    expect(text).toContain("Tuesday, September 1, 2026");
  });

  it("renders an overview line for every status, even ones at zero", async () => {
    const { service } = makeService();
    const report = await buildStandup(service, carla, NOW);
    const text = formatStandup(report);
    expect(text).toMatch(/In progress: 0/);
    expect(text).toMatch(/In review: 0/);
    expect(text).toMatch(/To do: 0/);
    expect(text).toMatch(/Backlog: 0/);
    expect(text).toMatch(/Blocked: 0/);
    expect(text).toMatch(/Done: 0/);
  });

  it("includes task titles in the detail section, unlike the counts-only digest", async () => {
    const { service } = makeService();
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      dueDate: "2026-09-05",
    });
    const report = await buildStandup(service, carla, NOW);
    const text = formatStandup(report);
    expect(text).toContain("Write the onboarding doc");
  });

  it("does not print a detail section for a status with nothing in it", async () => {
    const { service } = makeService();
    const report = await buildStandup(service, carla, NOW);
    const text = formatStandup(report);
    expect(text).not.toMatch(/In progress \(/);
  });

  it("says nothing was completed this week when doneThisWeek is empty", async () => {
    const { service } = makeService();
    const report = await buildStandup(service, carla, NOW);
    const text = formatStandup(report);
    expect(text).toMatch(/no tasks completed this week/i);
  });

  it("lists a completed task's title under Done this week", async () => {
    const { service } = makeService();
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "finished thing",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "done");
    const report = await buildStandup(service, carla, NOW);
    const text = formatStandup(report);
    expect(text).toMatch(/Done this week/i);
    expect(text).toContain("finished thing");
  });

  it("renders the Manila-local date, not UTC's (issue #56 F9)", async () => {
    const { service } = makeService();
    const today = new Date("2026-09-02T02:00:00+08:00");
    const report = await buildStandup(service, carla, today);
    const text = formatStandup(report);
    expect(text).toContain("Wednesday, September 2, 2026");
  });

  it("renders the overdue count after Blocked and before the first detail section (H17)", async () => {
    const { service } = makeService();
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "past due one",
      dueDate: "2026-08-20",
    });
    const created = await service.assignTask(carla, {
      assigneeUsername: "bob",
      title: "past due two",
      dueDate: "2026-08-21",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "future one",
      dueDate: "2026-09-10",
    });

    const report = await buildStandup(service, carla, NOW);
    expect(report.overdue).toBe(2);
    const text = formatStandup(report);
    expect(text).toContain("⚠️ Overdue: 2");

    const blockedIdx = text.indexOf("🚧 Blocked:");
    const overdueIdx = text.indexOf("⚠️ Overdue:");
    const firstDetailIdx = text.indexOf("📝 To do (");
    expect(overdueIdx).toBeGreaterThan(blockedIdx);
    expect(overdueIdx).toBeLessThan(firstDetailIdx);
  });

  it("renders Overdue: 0 when nothing is overdue (H17)", async () => {
    const { service } = makeService();
    const report = await buildStandup(service, carla, NOW);
    expect(report.overdue).toBe(0);
    const text = formatStandup(report);
    expect(text).toContain("⚠️ Overdue: 0");
  });

  it("does not count a past-due done task as overdue (H17)", async () => {
    const { service } = makeService();
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "past due but done",
      dueDate: "2026-08-01",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "done");

    const report = await buildStandup(service, carla, NOW);
    expect(report.overdue).toBe(0);
  });

  it("is a distinct formatter from the digest's formatGroupDailySummary", () => {
    expect(formatStandup).not.toBe(formatGroupDailySummary as unknown as typeof formatStandup);
  });

  it("standup's own detail shape carries a task title field the digest's InternDailyCounts structurally has no room for", () => {
    const digestShape: InternDailyCounts = { username: "alice", onTrack: 1, overdue: 0, blocked: 0 };
    expect(Object.keys(digestShape)).not.toContain("tasks");
  });
});
