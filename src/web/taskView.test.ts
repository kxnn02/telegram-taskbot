import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import {
  groupByAssignee,
  filterByStatusGroup,
  STATUS_GROUPS,
  groupByAction,
  ACTION_GROUPS,
} from "./taskView.js";

function task(overrides: Partial<TaskWithFlags>): TaskWithFlags {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "t",
    description: "d",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05",
    status: "Assigned",
    notes: [],
    blocked: false,
    blockedReason: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    overdue: false,
    daysOverdue: 0,
    ...overrides,
  };
}

describe("groupByAssignee", () => {
  it("groups tasks under their assignee username", () => {
    const tasks = [
      task({ id: 1, assigneeUsername: "alice" }),
      task({ id: 2, assigneeUsername: "bob" }),
      task({ id: 3, assigneeUsername: "alice" }),
    ];
    const grouped = groupByAssignee(tasks);
    expect(grouped.get("alice")?.map((t) => t.id)).toEqual([1, 3]);
    expect(grouped.get("bob")?.map((t) => t.id)).toEqual([2]);
  });

  it("returns an empty map for no tasks", () => {
    expect(groupByAssignee([]).size).toBe(0);
  });
});

describe("filterByStatusGroup", () => {
  const tasks = [
    task({ id: 1, status: "Approved" }),
    task({ id: 2, status: "Submitted" }),
    task({ id: 3, status: "InProgress", blocked: true, blockedReason: "stuck" }),
    task({ id: 4, status: "Assigned", overdue: true, daysOverdue: 3 }),
    task({ id: 5, status: "Assigned" }),
  ];

  it('"done" matches Approved tasks', () => {
    expect(filterByStatusGroup(tasks, "done").map((t) => t.id)).toEqual([1]);
  });

  it('"to-be-reviewed" matches Submitted tasks', () => {
    expect(filterByStatusGroup(tasks, "to-be-reviewed").map((t) => t.id)).toEqual([2]);
  });

  it('"blocked" matches tasks with the blocked flag set, regardless of status', () => {
    expect(filterByStatusGroup(tasks, "blocked").map((t) => t.id)).toEqual([3]);
  });

  it('"overdue-backlog" matches tasks with the overdue flag set', () => {
    expect(filterByStatusGroup(tasks, "overdue-backlog").map((t) => t.id)).toEqual([4]);
  });

  it("returns all tasks unfiltered when no group is given", () => {
    expect(filterByStatusGroup(tasks, undefined)).toEqual(tasks);
  });

  it("exposes the canonical set of status groups the dashboard filters by", () => {
    expect(STATUS_GROUPS).toEqual(["done", "to-be-reviewed", "blocked", "overdue-backlog"]);
  });
});

describe("groupByAction", () => {
  it("exposes the canonical set of action groups in precedence order", () => {
    expect(ACTION_GROUPS).toEqual(["needs-review", "blocked", "overdue", "done", "open"]);
  });

  it("puts a Submitted task in needs-review", () => {
    const tasks = [task({ id: 1, status: "Submitted" })];
    const grouped = groupByAction(tasks);
    expect(grouped.get("needs-review")?.map((t) => t.id)).toEqual([1]);
  });

  it("puts a Submitted+overdue task in needs-review, not overdue (Submitted wins precedence)", () => {
    const tasks = [task({ id: 1, status: "Submitted", overdue: true, daysOverdue: 2 })];
    const grouped = groupByAction(tasks);
    expect(grouped.get("needs-review")?.map((t) => t.id)).toEqual([1]);
    expect(grouped.get("overdue")?.map((t) => t.id) ?? []).toEqual([]);
  });

  it("puts a blocked+overdue task in blocked, not overdue", () => {
    const tasks = [
      task({ id: 1, status: "InProgress", blocked: true, blockedReason: "stuck", overdue: true, daysOverdue: 1 }),
    ];
    const grouped = groupByAction(tasks);
    expect(grouped.get("blocked")?.map((t) => t.id)).toEqual([1]);
    expect(grouped.get("overdue")?.map((t) => t.id) ?? []).toEqual([]);
  });

  it("puts a plain overdue task (not submitted, not blocked) in overdue", () => {
    const tasks = [task({ id: 1, status: "InProgress", overdue: true, daysOverdue: 5 })];
    const grouped = groupByAction(tasks);
    expect(grouped.get("overdue")?.map((t) => t.id)).toEqual([1]);
  });

  it("puts Approved and Cancelled tasks in done, even if overdue is somehow true", () => {
    const tasks = [
      task({ id: 1, status: "Approved", overdue: true, daysOverdue: 3 }),
      task({ id: 2, status: "Cancelled", overdue: true, daysOverdue: 3 }),
    ];
    const grouped = groupByAction(tasks);
    expect(grouped.get("done")?.map((t) => t.id)).toEqual([1, 2]);
  });

  it("puts NeedsRevision in open (it's the intern's ball again)", () => {
    const tasks = [task({ id: 1, status: "NeedsRevision" })];
    const grouped = groupByAction(tasks);
    expect(grouped.get("open")?.map((t) => t.id)).toEqual([1]);
  });

  it("puts ordinary Assigned/InProgress tasks in open", () => {
    const tasks = [task({ id: 1, status: "Assigned" }), task({ id: 2, status: "InProgress" })];
    const grouped = groupByAction(tasks);
    expect(grouped.get("open")?.map((t) => t.id)).toEqual([1, 2]);
  });

  it("preserves input order within each group", () => {
    const tasks = [
      task({ id: 3, status: "Assigned" }),
      task({ id: 1, status: "Assigned" }),
      task({ id: 2, status: "Assigned" }),
    ];
    const grouped = groupByAction(tasks);
    expect(grouped.get("open")?.map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("every group key is present in the map even when empty", () => {
    const grouped = groupByAction([]);
    for (const g of ACTION_GROUPS) {
      expect(grouped.get(g)).toEqual([]);
    }
  });
});
