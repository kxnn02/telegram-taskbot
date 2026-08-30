import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import { formatBlocked } from "./format.js";

function task(overrides: Partial<TaskWithFlags> = {}): TaskWithFlags {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "Write the onboarding doc",
    description: "d",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05",
    status: "InProgress",
    notes: [],
    blocked: true,
    blockedReason: "waiting on API access",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    overdue: false,
    daysOverdue: 0,
    ...overrides,
  };
}

describe("formatBlocked", () => {
  it("says nothing is blocked when the list is empty", () => {
    expect(formatBlocked([])).toBe("Nothing is currently flagged blocked.");
  });

  it("lists blocked tasks with assignee and reason", () => {
    const text = formatBlocked([task()]);
    expect(text).toContain("#1");
    expect(text).toContain("@alice");
    expect(text).toContain("waiting on API access");
  });
});
