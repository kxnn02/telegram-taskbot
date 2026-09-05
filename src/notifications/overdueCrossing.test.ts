import { describe, expect, it } from "vitest";
import type { Task } from "../domain/types.js";
import { findNewOverdueCrossings } from "./overdueCrossing.js";

const NOW = new Date("2026-09-10T02:00:00.000Z"); // 2026-09-10 10:00 Asia/Manila

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "Write the onboarding doc",
    description: "d",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05", // in the past relative to NOW
    status: "in_progress",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    priority: "medium",
    orderIndex: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("findNewOverdueCrossings", () => {
  it("includes an overdue task that hasn't been notified yet", async () => {
    const result = await findNewOverdueCrossings([task()], NOW, () => false);
    expect(result).toHaveLength(1);
  });

  it("excludes a task that was already notified", async () => {
    const result = await findNewOverdueCrossings([task({ id: 2 })], NOW, () => true);
    expect(result).toHaveLength(0);
  });

  it("excludes a task that isn't overdue yet", async () => {
    const result = await findNewOverdueCrossings(
      [task({ id: 3, dueDate: "2026-09-30" })],
      NOW,
      () => false,
    );
    expect(result).toHaveLength(0);
  });

  it("excludes an overdue-by-date task that's already done", async () => {
    const result = await findNewOverdueCrossings(
      [task({ id: 4, status: "done" })],
      NOW,
      () => false,
    );
    expect(result).toHaveLength(0);
  });

  it("checks notified state per-task, scoped by cohort id", async () => {
    let queried: Array<[string, number]> = [];
    await findNewOverdueCrossings([task({ id: 5, cohortId: "cohort-9" })], NOW, (cohortId, taskId) => {
      queried.push([cohortId, taskId]);
      return false;
    });
    expect(queried).toEqual([["cohort-9", 5]]);
  });
});
