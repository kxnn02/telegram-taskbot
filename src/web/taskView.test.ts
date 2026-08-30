import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import { groupByAssignee, filterByStatusGroup, STATUS_GROUPS } from "./taskView.js";

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
