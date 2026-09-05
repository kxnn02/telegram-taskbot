import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import type { TaskStatus } from "../domain/types.js";
import {
  chunkMessage,
  formatAllTasksGrouped,
  formatApproved,
  formatBacklog,
  formatBlocked,
  formatDeadlines,
  formatMyTasks,
  formatPending,
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

describe("formatBacklog (H10 — /overdue no longer calls itself Backlog)", () => {
  it("says nothing is overdue when the list is empty", () => {
    expect(formatBacklog([])).toBe("Nothing's overdue — nice.");
  });

  it("heads the list with 'Overdue:', not 'Backlog'", () => {
    const text = formatBacklog([task({ daysOverdue: 3 })]);
    expect(text).toContain("Overdue:");
    expect(text).not.toContain("Backlog");
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

describe("formatAllTasksGrouped empty result (issue #65, finding H9)", () => {
  it("reports plain emptiness when no filter was applied", () => {
    expect(formatAllTasksGrouped([], 1)).toBe("No tasks in this cohort yet.");
  });

  it("reports the filter when a member filter matched nothing", () => {
    expect(formatAllTasksGrouped([], 1, "@bob")).toBe("No tasks match @bob.");
  });

  it("reports the filter when a role filter matched nothing", () => {
    expect(formatAllTasksGrouped([], 1, "intern")).toBe("No tasks match intern.");
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

  it("hints at /tasks (not /alltasks) for the next page, with a filter prefix when given", () => {
    const text = formatAllTasksGrouped(tasks(11), 1, "@alice");
    expect(text).toContain("/tasks @alice 2");
  });

  it("hints at plain /tasks when no filter prefix is given (issue #33 renames /alltasks)", () => {
    const text = formatAllTasksGrouped(tasks(11), 1);
    expect(text).toContain("/tasks 2");
  });
});

describe("formatDeadlines", () => {
  it("says nothing is due when the list is empty", () => {
    expect(formatDeadlines([])).toBe("Nothing due in the next 7 days.");
  });

  it("lists upcoming tasks with assignee, soonest first as given", () => {
    const text = formatDeadlines([
      task({ id: 1, title: "sooner", dueDate: "2026-09-01", status: "todo", previousStatus: null, blockedReason: null }),
      task({ id: 2, title: "later", dueDate: "2026-09-05", status: "todo", previousStatus: null, blockedReason: null }),
    ]);
    expect(text.indexOf("#1")).toBeLessThan(text.indexOf("#2"));
    expect(text).toContain("@alice");
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

  it("heads the list with 'Marked done', not the removed review gate's 'Approved' (F14a)", () => {
    const text = formatApproved([task({ status: "done", previousStatus: null, blockedReason: null })]);
    expect(text).toContain("Marked done this past week:");
    expect(text).not.toContain("Approved this past week:");
  });
});

describe("formatPending", () => {
  it("says nothing pending when the list is empty", () => {
    expect(formatPending([])).toBe("Nothing pending review right now.");
  });

  it("heads the list with 'Awaiting review', not 'Awaiting your review' — it's cohort-wide, not personal (F14a)", () => {
    const text = formatPending([task({ status: "in_review", previousStatus: "in_progress", blockedReason: null })]);
    expect(text).toContain("Awaiting review:");
    expect(text).not.toContain("Awaiting your review:");
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

  describe("note timestamps are Manila-resolved, not raw UTC ISO instants (H12)", () => {
    it("renders 2026-09-01T16:05:00.000Z as Sep 2, 00:05", () => {
      const text = formatTaskDetail(
        task({
          notes: [{ text: "hi", authorUsername: "carla", createdAt: "2026-09-01T16:05:00.000Z" }],
        }),
      );
      expect(text).toContain("[Sep 2, 00:05] @carla: hi");
      expect(text).not.toContain("2026-09-01T16:05:00.000Z");
    });

    it("renders 2026-08-31T23:59:00.000Z as Sep 1, 07:59 (crosses the Manila/UTC date boundary)", () => {
      const text = formatTaskDetail(
        task({
          notes: [{ text: "hi", authorUsername: "carla", createdAt: "2026-08-31T23:59:00.000Z" }],
        }),
      );
      expect(text).toContain("[Sep 1, 07:59] @carla: hi");
    });

    it("falls back to the raw stored value for an unparseable createdAt, not 'Invalid DateTime'", () => {
      const text = formatTaskDetail(
        task({
          notes: [{ text: "hi", authorUsername: "carla", createdAt: "not-a-date" }],
        }),
      );
      expect(text).toContain("[not-a-date] @carla: hi");
      expect(text).not.toContain("Invalid DateTime");
    });
  });
});

describe("formatHelp", () => {
  it("lists /addtask, not the removed /assign", () => {
    const text = formatHelp();
    expect(text).toContain("/addtask");
    expect(text).not.toContain("/assign");
  });

  it("lists the surviving update commands, not any removed-command name", () => {
    const text = formatHelp();
    expect(text).toContain("/update");
    expect(text).toContain("/done");
    expect(text).toContain("/complete");
    expect(text).not.toMatch(/\/submit\b/);
    expect(text).not.toMatch(/\/approve\b/);
    expect(text).not.toMatch(/\/revise\b/);
    expect(text).not.toMatch(/\/canceltask\b/);
    expect(text).not.toContain("/unblock");
    expect(text).not.toMatch(/\/backlog\b/);
    expect(text).not.toContain("/edit");
    expect(text).not.toContain("/note");
    expect(text).not.toContain("/roster");
    expect(text).not.toContain("/dashboard");
    expect(text).not.toContain("/whoami");
    expect(text).not.toContain("/cancel");
    expect(text).not.toContain("/mytasks");
    expect(text).not.toContain("/overdue");
    expect(text).not.toContain("/pending");
  });

  it("has no access-control wording of any kind", () => {
    const text = formatHelp().toLowerCase();
    expect(text).not.toContain("higher-up");
    expect(text).not.toContain("intern");
    expect(text).not.toContain("restricted");
  });

  it("has a dedicated Statuses section listing all six statuses with a one-line meaning each", () => {
    const text = formatHelp();
    expect(text).toMatch(/Statuses/);
    expect(text).toMatch(/backlog.*not.*started/i);
    expect(text).toMatch(/todo.*ready/i);
    expect(text).toMatch(/in progress.*(actively )?being worked on/i);
    expect(text).toMatch(/in review.*(waiting|awaiting)/i);
    expect(text).toMatch(/blocked.*stuck/i);
    expect(text).toMatch(/done.*complete/i);
  });
});

describe("BOT_COMMANDS / formatHelp coherence", () => {
  it("every command Telegram's autocomplete menu offers also appears in /help", async () => {
    const { BOT_COMMANDS } = await import("./createBot.js");
    const helpText = formatHelp();
    for (const { command } of BOT_COMMANDS) {
      expect(helpText).toContain(`/${command}`);
    }
  });
});

describe("chunkMessage (issue #55/F8)", () => {
  it("text under the limit gives exactly one chunk", () => {
    const text = "line one\nline two\nline three";
    const chunks = chunkMessage(text);
    expect(chunks).toEqual([text]);
  });

  it("empty string still gives one chunk", () => {
    expect(chunkMessage("")).toEqual([""]);
  });

  it("text over the limit is split into multiple chunks, each under the limit, and rejoins with \\n to reproduce the input", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Task #${i} — some line of text to pad it out`);
    const text = lines.join("\n");

    const chunks = chunkMessage(text, 4000);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("a single line longer than the limit is hard-split, never emitted oversized", () => {
    const hugeLine = "x".repeat(10000);

    const chunks = chunkMessage(hugeLine, 4000);

    expect(chunks.join("")).toBe(hugeLine);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
    expect(chunks.length).toBe(3); // 4000 + 4000 + 2000
  });

  it("defaults the limit to 4000, not 4096", () => {
    const line = "x".repeat(4050);
    const chunks = chunkMessage(line);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });
});
