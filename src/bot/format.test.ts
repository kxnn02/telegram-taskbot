import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import type { TaskStatus } from "../domain/types.js";
import {
  formatAllTasksGrouped,
  formatApproved,
  formatBlocked,
  formatMyTasks,
  formatTaskLine,
  formatTaskDetail,
  formatHelp,
  statusLabel,
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

describe("statusLabel", () => {
  it("maps every stored status to #27's display label", () => {
    const expected: Record<TaskStatus, string> = {
      backlog: "Backlog",
      todo: "To do",
      in_progress: "In progress",
      in_review: "In review",
      blocked: "Blocked",
      done: "Done",
    };
    for (const [status, label] of Object.entries(expected)) {
      expect(statusLabel(status as TaskStatus)).toBe(label);
    }
  });
});

describe("formatTaskLine", () => {
  it("renders the display label, not the raw snake_case status", () => {
    const text = formatTaskLine(task({ status: "in_progress", previousStatus: null, blockedReason: null }));
    expect(text).toContain("In progress");
    expect(text).not.toContain("in_progress");
  });
});

describe("formatTaskDetail", () => {
  it("renders the display label in the Status line", () => {
    const text = formatTaskDetail(task({ status: "in_review", previousStatus: null, blockedReason: null }));
    expect(text).toContain("Status: In review");
  });
});

describe("formatHelp", () => {
  it("says nothing has changed for an unregistered caller", () => {
    expect(formatHelp(undefined)).toContain("/start");
  });

  it("doesn't reference the deleted review gate for interns", () => {
    const text = formatHelp("Intern");
    expect(text.toLowerCase()).not.toContain("only higher-ups");
  });

  it("doesn't reference the deleted review gate for higher-ups", () => {
    const text = formatHelp("HigherUp");
    expect(text.toLowerCase()).not.toContain("decide on a submitted task");
  });

  it("lists /addtask, not the removed /assign, for everyone (issue #30)", () => {
    const internText = formatHelp("Intern");
    expect(internText).toContain("/addtask");
    expect(internText).not.toContain("/assign");

    const higherUpText = formatHelp("HigherUp");
    expect(higherUpText).toContain("/addtask");
    expect(higherUpText).not.toContain("/assign");
  });

  it("describes direct /edit usage (issue #30/#31)", () => {
    const text = formatHelp("HigherUp");
    expect(text).toMatch(/\/edit <ref> <field> <value>/);
  });

  it("lists /update, /done, /complete, /overdue, /unblock — not the removed review-gate commands (issue #27/#31)", () => {
    const text = formatHelp("Intern");
    expect(text).toContain("/update");
    expect(text).toContain("/done");
    expect(text).toContain("/complete");
    expect(text).toContain("/overdue");
    expect(text).toContain("/unblock");
    expect(text).not.toMatch(/\/submit\b/);
    expect(text).not.toMatch(/\/approve\b/);
    expect(text).not.toMatch(/\/revise\b/);
    expect(text).not.toMatch(/\/canceltask\b/);
    expect(text).not.toContain("/unblocked");
    expect(text).not.toMatch(/\/backlog\b/);
  });
});
