import { describe, expect, it } from "vitest";
import type { Task } from "../domain/types.js";
import { approvedInPastWeek } from "./weeklyApproved.js";

const NOW = new Date("2026-09-08T02:00:00.000Z"); // Monday 10:00 Asia/Manila

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "Write the onboarding doc",
    description: "d",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-01",
    status: "done",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    priority: "medium",
    orderIndex: 0,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z", // 3 days before NOW
    ...overrides,
  };
}

describe("approvedInPastWeek", () => {
  it("includes a task Approved within the last 7 days", () => {
    const result = approvedInPastWeek([task()], NOW);
    expect(result).toHaveLength(1);
  });

  it("excludes a task Approved more than 7 days ago", () => {
    const result = approvedInPastWeek(
      [task({ id: 2, updatedAt: "2026-08-20T00:00:00.000Z" })],
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it("excludes a task that isn't done, regardless of updatedAt", () => {
    const result = approvedInPastWeek(
      [task({ id: 3, status: "in_review" })],
      NOW,
    );
    expect(result).toHaveLength(0);
  });
});
