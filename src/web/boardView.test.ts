import { describe, expect, it } from "vitest";
import type { Tag, Task, TaskStatus } from "../domain/types.js";
import { flattenTaskTags, groupTasksByStatus, reorderColumn } from "./boardView.js";

/**
 * Pure grouping/tagging/reordering logic for the dashboard's kanban board
 * (issue #105 sub-stage 5b), same convention as `taskView.ts`: operate only
 * on already-fetched data, no I/O.
 */

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "Task",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05",
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

describe("groupTasksByStatus", () => {
  it("puts each task in its status's bucket, in the fixed status order", () => {
    const tasks = [
      makeTask({ id: 1, status: "done" }),
      makeTask({ id: 2, status: "backlog" }),
      makeTask({ id: 3, status: "todo" }),
    ];
    const grouped = groupTasksByStatus(tasks);
    expect([...grouped.keys()]).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "blocked",
      "done",
    ]);
    expect(grouped.get("backlog")!.map((t) => t.id)).toEqual([2]);
    expect(grouped.get("todo")!.map((t) => t.id)).toEqual([3]);
    expect(grouped.get("done")!.map((t) => t.id)).toEqual([1]);
  });

  it("includes an empty array for a status with no tasks", () => {
    const grouped = groupTasksByStatus([makeTask({ id: 1, status: "todo" })]);
    expect(grouped.get("blocked")).toEqual([]);
    expect(grouped.get("in_review")).toEqual([]);
  });

  it("sorts each bucket by orderIndex ascending", () => {
    const tasks = [
      makeTask({ id: 1, status: "todo", orderIndex: 2 }),
      makeTask({ id: 2, status: "todo", orderIndex: 0 }),
      makeTask({ id: 3, status: "todo", orderIndex: 1 }),
    ];
    const grouped = groupTasksByStatus(tasks);
    expect(grouped.get("todo")!.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it("breaks orderIndex ties by id ascending", () => {
    const tasks = [
      makeTask({ id: 3, status: "todo", orderIndex: 0 }),
      makeTask({ id: 1, status: "todo", orderIndex: 0 }),
      makeTask({ id: 2, status: "todo", orderIndex: 0 }),
    ];
    const grouped = groupTasksByStatus(tasks);
    expect(grouped.get("todo")!.map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

describe("flattenTaskTags", () => {
  function makeTag(id: number, name: string): Tag {
    return { id, cohortId: "cohort-5", name, color: "#6366f1" };
  }

  it("gives a task with no tags an empty tags array", () => {
    const tasks = [{ id: 1 }];
    const result = flattenTaskTags(tasks, new Map(), new Map());
    expect(result).toEqual([{ id: 1, tags: [] }]);
  });

  it("resolves tag ids in ascending id order", () => {
    const tagsById = new Map([
      [1, makeTag(1, "A")],
      [2, makeTag(2, "B")],
    ]);
    const tagIdsByTask = new Map([[1, [2, 1]]]);
    const result = flattenTaskTags([{ id: 1 }], tagIdsByTask, tagsById);
    expect(result[0]!.tags.map((t) => t.name)).toEqual(["A", "B"]);
  });

  it("filters out tag ids that don't resolve to a known tag", () => {
    const tagsById = new Map([[1, makeTag(1, "A")]]);
    const tagIdsByTask = new Map([[1, [1, 999]]]);
    const result = flattenTaskTags([{ id: 1 }], tagIdsByTask, tagsById);
    expect(result[0]!.tags.map((t) => t.name)).toEqual(["A"]);
  });
});

describe("reorderColumn", () => {
  const col = [
    { id: 10, orderIndex: 0 },
    { id: 20, orderIndex: 1 },
    { id: 30, orderIndex: 2 },
    { id: 40, orderIndex: 3 },
  ];

  it("moves a task to the top", () => {
    const result = reorderColumn(col, 40, 0);
    expect(result.map((t) => t.id)).toEqual([40, 10, 20, 30]);
    expect(result.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
  });

  it("moves a task to the bottom", () => {
    const result = reorderColumn(col, 10, col.length - 1);
    expect(result.map((t) => t.id)).toEqual([20, 30, 40, 10]);
    expect(result.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
  });

  it("moves a task between two adjacent existing cards", () => {
    // Move task 10 to index 2, landing it between 30 and 40.
    const result = reorderColumn(col, 10, 2);
    expect(result.map((t) => t.id)).toEqual([20, 30, 10, 40]);
    expect(result.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
  });

  it("is a no-op (same sequential indices) when the target position doesn't change the order", () => {
    const result = reorderColumn(col, 20, 1);
    expect(result.map((t) => t.id)).toEqual([10, 20, 30, 40]);
    expect(result.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
  });

  it("does not mutate its input array", () => {
    const original = col.map((t) => ({ ...t }));
    reorderColumn(col, 10, 3);
    expect(col).toEqual(original);
  });

  it("clamps an out-of-range target index into the valid range", () => {
    const result = reorderColumn(col, 10, 999);
    expect(result.map((t) => t.id)).toEqual([20, 30, 40, 10]);
    const resultLow = reorderColumn(col, 40, -5);
    expect(resultLow.map((t) => t.id)).toEqual([40, 10, 20, 30]);
  });
});
