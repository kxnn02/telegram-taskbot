import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "../service/taskService.js";
import { formatGroupDailySummary } from "../notifications/digestFormat.js";
import type { MemberDailyCounts } from "../notifications/digestFormat.js";
import {
  buildStandup,
  buildStandupKeyboard,
  formatStandup,
  formatStandupFiltered,
  parseStandupCallback,
  STANDUP_ACTIVE_COUNT_STATUSES,
  STANDUP_FILTER_STATUSES,
  VALID_STANDUP_FILTERS,
} from "./standup.js";

const COHORT = "cohort-5";
const NOW = new Date("2026-09-01T02:00:00.000Z"); // Tuesday

function makeRoster() {
  return new Roster([
    { username: "carla", cohortId: COHORT },
    { username: "alice", cohortId: COHORT },
    { username: "bob", cohortId: COHORT },
  ]);
}

const carla: Caller = { username: "carla", cohortId: COHORT };
const alice: Caller = { username: "alice", cohortId: COHORT };

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

  it("standup's own detail shape carries a task title field the digest's MemberDailyCounts structurally has no room for", () => {
    const digestShape: MemberDailyCounts = { username: "alice", onTrack: 1, overdue: 0, blocked: 0 };
    expect(Object.keys(digestShape)).not.toContain("tasks");
  });
});

// ---- Issue #103 item 3: standup filters ---------------------------------

describe("STANDUP_FILTER_STATUSES — one test per filter, naming exactly which statuses it includes", () => {
  it("overview includes every one of the six statuses", () => {
    expect([...STANDUP_FILTER_STATUSES.overview].sort()).toEqual(
      ["backlog", "blocked", "done", "in_progress", "in_review", "todo"].sort(),
    );
  });

  it("active includes in_progress, in_review and todo — and nothing else", () => {
    expect([...STANDUP_FILTER_STATUSES.active].sort()).toEqual(
      ["in_progress", "in_review", "todo"].sort(),
    );
  });

  it("backlog includes backlog only", () => {
    expect([...STANDUP_FILTER_STATUSES.backlog]).toEqual(["backlog"]);
  });

  it("review includes in_review only", () => {
    expect([...STANDUP_FILTER_STATUSES.review]).toEqual(["in_review"]);
  });

  it("done includes done only", () => {
    expect([...STANDUP_FILTER_STATUSES.done]).toEqual(["done"]);
  });

  it("the active *count* additionally includes blocked, which the active *list* does not — Devie's wart", () => {
    expect([...STANDUP_ACTIVE_COUNT_STATUSES].sort()).toEqual(
      ["blocked", "in_progress", "in_review", "todo"].sort(),
    );
    expect(STANDUP_FILTER_STATUSES.active).not.toContain("blocked");
  });

  it("VALID_STANDUP_FILTERS is exactly Devie's five", () => {
    expect([...VALID_STANDUP_FILTERS].sort()).toEqual(
      ["active", "backlog", "done", "overview", "review"].sort(),
    );
  });
});

describe("parseStandupCallback", () => {
  it("parses a filter and a page out of the callback payload", () => {
    expect(parseStandupCallback("standup|active|0")).toEqual({ filter: "active", page: 0 });
    expect(parseStandupCallback("standup|review|3")).toEqual({ filter: "review", page: 3 });
  });

  it("rejects an unknown filter", () => {
    expect(parseStandupCallback("standup|nonsense|0")).toBeUndefined();
  });

  it("rejects a payload that is not a standup callback", () => {
    expect(parseStandupCallback("tasks|all|0")).toBeUndefined();
    expect(parseStandupCallback("")).toBeUndefined();
  });

  it("rejects a non-numeric page", () => {
    expect(parseStandupCallback("standup|active|x")).toBeUndefined();
  });
});

describe("buildStandupKeyboard (issue #103 item 3)", () => {
  async function reportWith(counts: {
    todo?: number;
    review?: number;
    backlog?: number;
    blocked?: number;
    done?: number;
  }) {
    const { service } = makeService();
    for (const [key, status] of [
      ["todo", "todo"],
      ["review", "in_review"],
      ["backlog", "backlog"],
      ["blocked", "blocked"],
      ["done", "done"],
    ] as const) {
      for (let i = 0; i < (counts[key] ?? 0); i++) {
        const created = await service.assignTask(carla, {
          assigneeUsername: "alice",
          title: `${status} ${i}`,
          dueDate: "2026-09-05",
        });
        if (!created.ok) throw new Error("setup failed");
        if (status !== "todo") await service.setStatus(carla, created.value.id, status);
      }
    }
    return buildStandup(service, carla, NOW);
  }

  it("is one row of Devie's five buttons, with counts and standup| payloads", async () => {
    const report = await reportWith({ todo: 2, review: 1, backlog: 3, blocked: 1, done: 4 });
    const keyboard = buildStandupKeyboard(report, "overview");

    expect(keyboard.inline_keyboard).toHaveLength(1);
    expect(keyboard.inline_keyboard[0]).toEqual([
      { text: "· 📊 Overview", callback_data: "standup|overview|0" },
      { text: "Active (4)", callback_data: "standup|active|0" },
      { text: "Backlog (3)", callback_data: "standup|backlog|0" },
      { text: "Review (1)", callback_data: "standup|review|0" },
      { text: "Done (4)", callback_data: "standup|done|0" },
    ]);
  });

  it("moves the leading dot onto whichever filter is active", async () => {
    const report = await reportWith({ todo: 1 });
    const keyboard = buildStandupKeyboard(report, "backlog");
    const labels = keyboard.inline_keyboard[0]!.map((b) => b.text);
    expect(labels.filter((l) => l.startsWith("· "))).toEqual(["· Backlog (0)"]);
  });
});

describe("formatStandupFiltered (issue #103 item 3)", () => {
  async function seed(
    service: TaskService,
    title: string,
    status: "backlog" | "todo" | "in_progress" | "in_review" | "blocked" | "done",
  ) {
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title,
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    if (status !== "todo") await service.setStatus(carla, created.value.id, status);
    return created.value.id;
  }

  it("overview is the existing formatStandup, unchanged", async () => {
    const { service } = makeService();
    await seed(service, "Write the docs", "todo");
    const report = await buildStandup(service, carla, NOW);
    expect(formatStandupFiltered(report, "overview")).toBe(formatStandup(report));
  });

  it("active lists in-progress, in-review and todo tasks grouped by member", async () => {
    const { service } = makeService();
    await seed(service, "Doing it", "in_progress");
    await seed(service, "Reviewing it", "in_review");
    await seed(service, "Queued", "todo");
    await seed(service, "Stuck", "blocked");
    await seed(service, "Parked", "backlog");

    const text = formatStandupFiltered(await buildStandup(service, carla, NOW), "active");
    // The count includes blocked; the list deliberately does not (Devie).
    expect(text).toContain("🔄 Active (4)");
    expect(text).toContain("@alice:");
    expect(text).toContain("Doing it");
    expect(text).toContain("Reviewing it");
    expect(text).toContain("Queued");
    expect(text).not.toContain("Stuck");
    expect(text).not.toContain("Parked");
  });

  it("backlog lists only backlog tasks", async () => {
    const { service } = makeService();
    await seed(service, "Parked", "backlog");
    await seed(service, "Queued", "todo");

    const text = formatStandupFiltered(await buildStandup(service, carla, NOW), "backlog");
    expect(text).toContain("📦 Backlog (1)");
    expect(text).toContain("Parked");
    expect(text).not.toContain("Queued");
  });

  it("review lists only in-review tasks", async () => {
    const { service } = makeService();
    await seed(service, "Reviewing it", "in_review");
    await seed(service, "Queued", "todo");

    const text = formatStandupFiltered(await buildStandup(service, carla, NOW), "review");
    expect(text).toContain("👀 For Review (1)");
    expect(text).toContain("Reviewing it");
    expect(text).not.toContain("Queued");
  });

  it("done lists this week's completions only", async () => {
    const { service } = makeService();
    await seed(service, "Finished", "done");
    await seed(service, "Queued", "todo");

    const text = formatStandupFiltered(await buildStandup(service, carla, NOW), "done");
    expect(text).toContain("✅ Done this week (1)");
    expect(text).toContain("Finished");
    expect(text).not.toContain("Queued");
  });

  it("every filter carries the cohort/date header", async () => {
    const { service } = makeService();
    await seed(service, "Queued", "todo");
    const report = await buildStandup(service, carla, NOW);
    for (const filter of VALID_STANDUP_FILTERS) {
      expect(formatStandupFiltered(report, filter)).toContain("Cohort 5 — Daily Standup");
    }
  });

  it("uses Devie's empty-state wording for each filter, verbatim", async () => {
    const { service } = makeService();
    const report = await buildStandup(service, carla, NOW);
    expect(formatStandupFiltered(report, "active")).toContain("No active tasks right now.");
    expect(formatStandupFiltered(report, "backlog")).toContain("Backlog is clear!");
    expect(formatStandupFiltered(report, "review")).toContain(
      "Nothing waiting for review right now.",
    );
    expect(formatStandupFiltered(report, "done")).toContain("No tasks completed this week yet.");
  });

  it("cohort isolation: another cohort's tasks appear under no filter", async () => {
    const store = new InMemoryTaskStore();
    const roster = new Roster([
      { username: "carla", cohortId: COHORT },
      { username: "alice", cohortId: COHORT },
      { username: "other", cohortId: "cohort-9" },
    ]);
    const service = new TaskService(store, roster, new FixedClock(NOW));
    await service.assignTask(
      { username: "other", cohortId: "cohort-9" },
      { assigneeUsername: "other", title: "Secret task", dueDate: "2026-09-05" },
    );
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Queued",
      dueDate: "2026-09-05",
    });

    const report = await buildStandup(service, carla, NOW);
    for (const filter of VALID_STANDUP_FILTERS) {
      expect(formatStandupFiltered(report, filter)).not.toContain("Secret task");
    }
  });
});
