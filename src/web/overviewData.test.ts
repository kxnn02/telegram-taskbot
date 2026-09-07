import { describe, expect, it } from "vitest";
import type { Task } from "../domain/types.js";
import { buildOverviewView } from "./overviewData.js";

/**
 * Pure view-builder for the dashboard's Overview page (issue #124 stage
 * S4), same convention as `boardView.ts`/`statsView.ts`: operate only on
 * already-fetched data, no I/O, no React.
 */

const NOW = new Date("2026-09-07T02:00:00.000Z"); // 2026-09-07 10:00 Asia/Manila (Monday)

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "Task",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-10",
    status: "todo",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    priority: "medium",
    orderIndex: 0,
    createdAt: "2026-08-31T02:00:00.000Z",
    updatedAt: "2026-08-31T02:00:00.000Z",
    ...overrides,
  };
}

describe("buildOverviewView", () => {
  it("counts each of the seven stats", () => {
    const tasks = [
      makeTask({ id: 1, status: "done" }),
      makeTask({ id: 2, status: "in_progress" }),
      makeTask({ id: 3, status: "in_review" }),
      makeTask({ id: 4, status: "blocked" }),
      makeTask({ id: 5, status: "todo", priority: "urgent" }),
      makeTask({ id: 6, status: "backlog", dueDate: "2026-09-01" }), // overdue
    ];
    const view = buildOverviewView(tasks, NOW);
    expect(view.stats).toEqual([
      { key: "total", label: "Total Tasks", value: 6 },
      { key: "done", label: "Completed", value: 1, sub: "17% rate" },
      { key: "inProgress", label: "In Progress", value: 1 },
      { key: "inReview", label: "In Review", value: 1 },
      { key: "blocked", label: "Blocked", value: 1 },
      { key: "urgent", label: "Urgent", value: 1 },
      { key: "overdue", label: "Overdue", value: 1 },
    ]);
  });

  it("guards the divide when there are no tasks, with donePercent zero", () => {
    const view = buildOverviewView([], NOW);
    expect(view.donePercent).toBe(0);
    expect(view.totalTasks).toBe(0);
    expect(view.stats.find((s) => s.key === "done")).toEqual({
      key: "done",
      label: "Completed",
      value: 0,
      sub: "0% rate",
    });
  });

  it("rounds donePercent to the nearest whole number", () => {
    const tasks = [
      makeTask({ id: 1, status: "done" }),
      makeTask({ id: 2, status: "done" }),
      makeTask({ id: 3, status: "todo" }),
    ];
    const view = buildOverviewView(tasks, NOW);
    expect(view.donePercent).toBe(67);
  });

  it("orders recentTasks by updatedAt descending and caps at 12", () => {
    const tasks = Array.from({ length: 15 }, (_, i) =>
      makeTask({ id: i + 1, updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }),
    );
    const view = buildOverviewView(tasks, NOW);
    expect(view.recentTasks).toHaveLength(12);
    expect(view.recentTasks[0]!.id).toBe(15);
    expect(view.recentTasks[11]!.id).toBe(4);
  });

  it("excludes done tasks from the urgent count even when priority is urgent", () => {
    const tasks = [
      makeTask({ id: 1, priority: "urgent", status: "done" }),
      makeTask({ id: 2, priority: "urgent", status: "todo" }),
    ];
    const view = buildOverviewView(tasks, NOW);
    expect(view.urgentCount).toBe(1);
  });

  it("does not count a task due today as overdue", () => {
    const tasks = [makeTask({ id: 1, dueDate: "2026-09-07", status: "todo" })];
    const view = buildOverviewView(tasks, NOW);
    expect(view.overdueCount).toBe(0);
  });

  it("counts a task due yesterday as overdue", () => {
    const tasks = [makeTask({ id: 1, dueDate: "2026-09-06", status: "todo" })];
    const view = buildOverviewView(tasks, NOW);
    expect(view.overdueCount).toBe(1);
  });

  it("does not count a done task as overdue even when its due date has passed", () => {
    const tasks = [makeTask({ id: 1, dueDate: "2026-09-01", status: "done" })];
    const view = buildOverviewView(tasks, NOW);
    expect(view.overdueCount).toBe(0);
  });
});
