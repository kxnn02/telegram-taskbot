import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import { esc } from "./html.js";
import {
  bucketByMember,
  bucketOf,
  NO_OPEN_TASKS_HTML,
  NO_OPEN_TASKS_PLAIN,
  renderMemberBucketsHtml,
  renderMemberBucketsPlain,
  standupSummaryLine,
  reviewQueue,
  renderReviewQueueHtml,
  renderReviewQueuePlain,
} from "./standupBuckets.js";

// Issue #166 (S1 of #165): the shared Overdue / Doing / For approval bucket
// rules, the summary line, and both member renderers. Pure functions only.

function baseTask(overrides: Partial<TaskWithFlags> = {}): TaskWithFlags {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "Ship the thing",
    description: undefined,
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-12", // a Saturday, Asia/Manila
    status: "in_progress",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    priority: "medium",
    orderIndex: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    overdue: false,
    daysOverdue: 0,
    ...overrides,
  };
}

describe("bucketOf", () => {
  it("done -> undefined", () => {
    expect(bucketOf(baseTask({ status: "done" }))).toBeUndefined();
  });

  it("done -> undefined even when overdue is forced true", () => {
    expect(bucketOf(baseTask({ status: "done", overdue: true }))).toBeUndefined();
  });

  it("in_progress + overdue -> overdue", () => {
    expect(bucketOf(baseTask({ status: "in_progress", overdue: true }))).toBe("overdue");
  });

  it("in_review + overdue -> overdue, not for_approval", () => {
    expect(bucketOf(baseTask({ status: "in_review", overdue: true }))).toBe("overdue");
  });

  it("backlog + overdue -> overdue, not undefined", () => {
    expect(bucketOf(baseTask({ status: "backlog", overdue: true }))).toBe("overdue");
  });

  it("in_review, not overdue -> for_approval", () => {
    expect(bucketOf(baseTask({ status: "in_review", overdue: false }))).toBe("for_approval");
  });

  it("backlog, not overdue -> undefined", () => {
    expect(bucketOf(baseTask({ status: "backlog", overdue: false }))).toBeUndefined();
  });

  it.each(["in_progress", "todo", "blocked"] as const)("%s, not overdue -> doing", (status) => {
    expect(bucketOf(baseTask({ status, overdue: false }))).toBe("doing");
  });
});

describe("bucketByMember", () => {
  it("sorts members alphabetically regardless of input order", () => {
    const tasks = [
      baseTask({ id: 1, assigneeUsername: "charlie" }),
      baseTask({ id: 2, assigneeUsername: "alice" }),
      baseTask({ id: 3, assigneeUsername: "bob" }),
    ];
    expect(bucketByMember(tasks).map((m) => m.username)).toEqual(["alice", "bob", "charlie"]);
  });

  it("orders a member's buckets overdue -> doing -> for_approval regardless of input order", () => {
    const tasks = [
      baseTask({ id: 1, status: "in_review", overdue: false }),
      baseTask({ id: 2, status: "in_progress", overdue: false }),
      baseTask({ id: 3, status: "in_progress", overdue: true }),
    ];
    expect(bucketByMember(tasks)[0]!.buckets.map((b) => b.bucket)).toEqual([
      "overdue",
      "doing",
      "for_approval",
    ]);
  });

  it("a member with only an in_review task yields exactly one for_approval bucket", () => {
    const tasks = [baseTask({ status: "in_review", overdue: false })];
    const [member] = bucketByMember(tasks);
    expect(member!.buckets).toHaveLength(1);
    expect(member!.buckets[0]!.bucket).toBe("for_approval");
  });

  it("a member with only done and backlog tasks does not appear", () => {
    const tasks = [
      baseTask({ status: "done" }),
      baseTask({ status: "backlog", overdue: false }),
    ];
    expect(bucketByMember(tasks)).toEqual([]);
  });

  it("sorts tasks within a bucket by dueDate then id", () => {
    const tasks = [
      baseTask({ id: 9, dueDate: "2026-09-15", status: "todo", overdue: false }),
      baseTask({ id: 5, dueDate: "2026-09-10", status: "todo", overdue: false }),
      baseTask({ id: 3, dueDate: "2026-09-10", status: "todo", overdue: false }),
    ];
    const [member] = bucketByMember(tasks);
    expect(member!.buckets[0]!.tasks.map((t) => t.id)).toEqual([3, 5, 9]);
  });

  it("empty input -> empty output", () => {
    expect(bucketByMember([])).toEqual([]);
  });
});

describe("standupSummaryLine", () => {
  it("all zero on empty input", () => {
    expect(standupSummaryLine([])).toBe(
      "⚠️ 0 overdue · 🔄 0 doing · 👀 0 for approval · 📦 0 backlog · ✅ 0 done",
    );
  });

  it("counts a mixed set correctly", () => {
    const tasks = [
      ...Array.from({ length: 2 }, (_, i) =>
        baseTask({ id: 100 + i, status: "in_progress", overdue: true }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        baseTask({ id: 200 + i, status: "todo", overdue: false }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        baseTask({ id: 300 + i, status: "in_review", overdue: false }),
      ),
      baseTask({ id: 400, status: "backlog", overdue: false }),
      ...Array.from({ length: 8 }, (_, i) => baseTask({ id: 500 + i, status: "done" })),
    ];
    expect(standupSummaryLine(tasks)).toBe(
      "⚠️ 2 overdue · 🔄 3 doing · 👀 2 for approval · 📦 1 backlog · ✅ 8 done",
    );
  });

  it("an overdue backlog task counts as overdue, not backlog", () => {
    const tasks = [baseTask({ status: "backlog", overdue: true })];
    expect(standupSummaryLine(tasks)).toBe(
      "⚠️ 1 overdue · 🔄 0 doing · 👀 0 for approval · 📦 0 backlog · ✅ 0 done",
    );
  });

  it("carries no HTML tags", () => {
    const tasks = [baseTask({ status: "in_progress", overdue: true })];
    const line = standupSummaryLine(tasks);
    expect(line).not.toContain("<");
    expect(line).not.toContain(">");
  });
});

describe("renderMemberBucketsHtml", () => {
  it("renders one member with all three buckets exactly", () => {
    const tasks = [
      baseTask({
        id: 7,
        title: "Finalize demo slides",
        status: "in_progress",
        overdue: true,
        priority: "urgent",
        dueDate: "2026-09-07", // Monday
      }),
      baseTask({
        id: 1,
        title: "Fix login redirect",
        status: "in_progress",
        overdue: false,
        priority: "urgent",
        dueDate: "2026-09-11", // Friday
      }),
      baseTask({
        id: 2,
        title: "Ship tasks API",
        status: "in_review",
        overdue: false,
        priority: "medium",
        dueDate: "2026-09-09", // Wednesday
      }),
    ];

    expect(renderMemberBucketsHtml(tasks)).toEqual([
      "",
      "👤 <b>@alice</b>",
      "⚠️ <b>Overdue (1)</b>",
      "▸ <code>T-007</code> Finalize demo slides 🔴 🔄 · Mon, Sep 7",
      "🔄 <b>Doing (1)</b>",
      "▸ <code>T-001</code> Fix login redirect 🔴 🔄 · Fri, Sep 11",
      "👀 <b>For approval (1)</b>",
      "▸ <code>T-002</code> Ship tasks API 👀 · Wed, Sep 9",
    ]);
  });

  it("escapes the username via esc", () => {
    const tasks = [baseTask({ assigneeUsername: "a<b", status: "in_progress", overdue: true })];
    const lines = renderMemberBucketsHtml(tasks);
    expect(lines[1]).toBe(`👤 <b>@${esc("a<b")}</b>`);
  });

  it("empty input -> the no-open-tasks html line", () => {
    expect(renderMemberBucketsHtml([])).toEqual(["", NO_OPEN_TASKS_HTML]);
  });
});

describe("renderMemberBucketsPlain", () => {
  it("renders one member with two buckets exactly", () => {
    const tasks = [
      baseTask({
        id: 5,
        title: "Deploy staging",
        status: "in_progress",
        overdue: false,
        dueDate: "2026-09-10",
      }),
      baseTask({
        id: 11,
        title: "Refactor auth module",
        status: "in_review",
        overdue: false,
        dueDate: "2026-09-11",
      }),
    ];

    expect(renderMemberBucketsPlain(tasks)).toEqual([
      "",
      "👤 @alice",
      "🔄 Doing (1)",
      "  - #5 Deploy staging — 🔄 In progress (due 2026-09-10)",
      "👀 For approval (1)",
      "  - #11 Refactor auth module — 👀 In review (due 2026-09-11)",
    ]);
  });

  it("no line contains HTML tags", () => {
    const tasks = [baseTask({ status: "in_progress", overdue: true })];
    for (const line of renderMemberBucketsPlain(tasks)) {
      expect(line).not.toContain("<b>");
      expect(line).not.toContain("<i>");
      expect(line).not.toContain("<code>");
    }
  });

  it("empty input -> the no-open-tasks plain line", () => {
    expect(renderMemberBucketsPlain([])).toEqual(["", NO_OPEN_TASKS_PLAIN]);
  });
});

describe("reviewQueue", () => {
  it("includes an overdue in_review task (the critical trap)", () => {
    const tasks = [
      baseTask({
        id: 99,
        title: "Critical review",
        status: "in_review",
        overdue: true,
        daysOverdue: 3,
        dueDate: "2026-09-05",
      }),
    ];
    expect(reviewQueue(tasks)).toHaveLength(1);
    expect(reviewQueue(tasks)[0]!.id).toBe(99);
  });

  it("excludes backlog, todo, in_progress, blocked, done", () => {
    const tasks = [
      baseTask({ id: 1, status: "backlog", overdue: false }),
      baseTask({ id: 2, status: "todo", overdue: false }),
      baseTask({ id: 3, status: "in_progress", overdue: false }),
      baseTask({ id: 4, status: "blocked", overdue: false }),
      baseTask({ id: 5, status: "done", overdue: false }),
    ];
    expect(reviewQueue(tasks)).toEqual([]);
  });

  it("sorts by due date then id", () => {
    const tasks = [
      baseTask({ id: 9, status: "in_review", dueDate: "2026-09-15", overdue: false }),
      baseTask({ id: 5, status: "in_review", dueDate: "2026-09-10", overdue: false }),
      baseTask({ id: 3, status: "in_review", dueDate: "2026-09-10", overdue: false }),
    ];
    const result = reviewQueue(tasks);
    expect(result.map((t) => t.id)).toEqual([3, 5, 9]);
  });

  it("empty input -> empty output", () => {
    expect(reviewQueue([])).toEqual([]);
  });
});

describe("renderReviewQueueHtml", () => {
  it("renders the header with task count", () => {
    const tasks = [
      baseTask({ id: 1, status: "in_review", overdue: false }),
      baseTask({ id: 2, status: "in_review", overdue: false }),
    ];
    const lines = renderReviewQueueHtml(tasks);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("👀 <b>For Review and Approval (2) — Dom / Jedd</b>");
  });

  it("renders one task with showStatus=false", () => {
    const tasks = [
      baseTask({
        id: 14,
        title: "Module 3 slide deck",
        status: "in_review",
        overdue: false,
        priority: "urgent",
        dueDate: "2026-09-12",
      }),
    ];
    const lines = renderReviewQueueHtml(tasks);
    expect(lines[2]).toContain("T-014");
    expect(lines[2]).toContain("Module 3 slide deck");
    expect(lines[2]).toContain("@alice");
    expect(lines[2]).not.toContain("👀");
  });

  it("renders overdue task with ⚠️", () => {
    const tasks = [
      baseTask({
        id: 1,
        status: "in_review",
        overdue: true,
        dueDate: "2026-09-05",
      }),
    ];
    const lines = renderReviewQueueHtml(tasks);
    expect(lines[2]).toContain("⚠️");
  });

  it("HTML-escapes title and username", () => {
    const tasks = [
      baseTask({
        id: 1,
        title: "Test <b>bold</b> & amp",
        assigneeUsername: "a<b",
        status: "in_review",
        overdue: false,
      }),
    ];
    const lines = renderReviewQueueHtml(tasks);
    expect(lines[2]).toContain(esc("Test <b>bold</b> & amp"));
    expect(lines[2]).toContain(esc("a<b"));
  });

  it("empty state: renders header with (0) and empty message", () => {
    const lines = renderReviewQueueHtml([]);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("👀 <b>For Review and Approval (0) — Dom / Jedd</b>");
    expect(lines[2]).toBe("<i>Nothing waiting for review right now.</i>");
  });
});

describe("renderReviewQueuePlain", () => {
  it("renders the header with task count", () => {
    const tasks = [
      baseTask({ id: 1, status: "in_review", overdue: false }),
      baseTask({ id: 2, status: "in_review", overdue: false }),
    ];
    const lines = renderReviewQueuePlain(tasks);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("👀 For Review and Approval (2) — Dom / Jedd");
  });

  it("renders one task with due date and assignee", () => {
    const tasks = [
      baseTask({
        id: 5,
        title: "Fix something",
        status: "in_review",
        overdue: false,
        dueDate: "2026-09-12",
        assigneeUsername: "alice",
      }),
    ];
    const lines = renderReviewQueuePlain(tasks);
    expect(lines[2]).toBe("  - #5 Fix something (@alice) — due 2026-09-12");
  });

  it("renders overdue task with [⚠️ OVERDUE Xd]", () => {
    const tasks = [
      baseTask({
        id: 1,
        title: "Overdue review",
        status: "in_review",
        overdue: true,
        daysOverdue: 2,
        dueDate: "2026-09-05",
      }),
    ];
    const lines = renderReviewQueuePlain(tasks);
    expect(lines[2]).toContain("[⚠️ OVERDUE 2d]");
  });

  it("does not HTML-escape in plain output", () => {
    const tasks = [
      baseTask({
        id: 1,
        title: "Test <b>bold</b> & amp",
        status: "in_review",
        overdue: false,
      }),
    ];
    const lines = renderReviewQueuePlain(tasks);
    expect(lines[2]).toContain("Test <b>bold</b> & amp");
    expect(lines[2]).not.toContain("&lt;");
  });

  it("empty state: renders header with (0) and empty message", () => {
    const lines = renderReviewQueuePlain([]);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("👀 For Review and Approval (0) — Dom / Jedd");
    expect(lines[2]).toBe("Nothing waiting for review right now.");
  });
});
