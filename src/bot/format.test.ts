import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import {
  formatAllTasksGrouped,
  formatApproved,
  formatBlocked,
  formatMyTasks,
} from "./format.js";

function task(overrides: Partial<TaskWithFlags> = {}): TaskWithFlags {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "Write the onboarding doc",
    description: "d",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05",
    status: "blocked",
    notes: [],
    previousStatus: "in_progress",
    blockedReason: "waiting on API access",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    overdue: false,
    daysOverdue: 0,
    ...overrides,
  };
}

function tasks(count: number, overrides: Partial<TaskWithFlags> = {}): TaskWithFlags[] {
  return Array.from({ length: count }, (_, i) =>
    task({ id: i + 1, title: `Task ${i + 1}`, status: "todo", previousStatus: null, blockedReason: null, ...overrides }),
  );
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

describe("formatMyTasks pagination", () => {
  it("shows no pagination footer when everything fits on one page", () => {
    const text = formatMyTasks(tasks(10));
    expect(text).not.toMatch(/Page \d+ of \d+/);
    expect(text).toContain("#1");
    expect(text).toContain("#10");
  });

  it("splits into pages of 10 once the list exceeds the page size", () => {
    const text = formatMyTasks(tasks(11));
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("/mytasks 2");
    expect(text).toContain("#1");
    expect(text).toContain("#10");
    expect(text).not.toContain("#11");
  });

  it("returns the requested page's slice", () => {
    const text = formatMyTasks(tasks(11), 2);
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("#11");
    expect(text).not.toContain("#10");
  });
});

describe("formatAllTasksGrouped pagination", () => {
  it("shows no pagination footer for a small result set", () => {
    const text = formatAllTasksGrouped(tasks(5));
    expect(text).not.toMatch(/Page \d+ of \d+/);
  });

  it("paginates and preserves per-assignee grouping within a page", () => {
    const aliceTasks = tasks(6, { assigneeUsername: "alice" });
    const bobTasks = tasks(6, { assigneeUsername: "bob" }).map((t, i) => ({
      ...t,
      id: i + 7,
      title: `Task ${i + 7}`,
    }));
    const all = [...aliceTasks, ...bobTasks];

    const page1 = formatAllTasksGrouped(all, 1);
    expect(page1).toContain("Page 1 of 2");
    expect(page1).toContain("@alice:");
    expect(page1).toContain("#1");
    expect(page1).toContain("#10");
    expect(page1).not.toContain("#11");

    const page2 = formatAllTasksGrouped(all, 2);
    expect(page2).toContain("Page 2 of 2");
    expect(page2).toContain("#11");
    expect(page2).toContain("#12");
  });
});

describe("formatApproved", () => {
  it("says nothing when the list is empty", () => {
    expect(formatApproved([])).toBe("Nothing was approved in the past week.");
  });

  it("lists approved tasks with assignee", () => {
    const text = formatApproved([task({ status: "done", previousStatus: null, blockedReason: null })]);
    expect(text).toContain("#1");
    expect(text).toContain("@alice");
  });
});
