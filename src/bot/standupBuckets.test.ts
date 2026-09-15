import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import { esc } from "./html.js";
import {
  bucketByMember,
  bucketOf,
  NO_OPEN_TASKS_HTML,
  renderMemberBucketsHtml,
  standupSummaryLine,
  reviewQueue,
  renderReviewQueueHtml,
  REVIEW_QUEUE_RULE,
} from "./standupBuckets.js";

const NOW = new Date("2026-09-01T00:00:00.000Z");

// Issue #166 (S1 of #165): the shared Overdue / Doing / For approval bucket
// rules, the summary line, and the HTML member renderer. Pure functions
// only. Issue #209: the plain-text renderers this file used to also cover
// (`renderMemberBucketsPlain`/`renderReviewQueuePlain`) are gone — both
// standup surfaces render through this HTML vocabulary now.

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
        dueDate: "2026-08-25", // 7 days before NOW
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

    // Issue #209: the due date renders through the shared date renderer, so
    // the overdue task reads as elapsed time ("7 days ago") rather than a
    // calendar date — the trap this ticket exists to fix.
    //
    // Issue #210: task #2 is `in_review`, so it's now de-duplicated out of
    // this member's "For approval" bucket entirely — it belongs to the
    // review queue only (`renderReviewQueueHtml`), which is what makes "For
    // approval" never appear in a member's block any more.
    expect(renderMemberBucketsHtml(tasks, NOW)).toEqual([
      "",
      "👤 <b>@alice</b>",
      "⚠️ <b>Overdue (1)</b>",
      "▸ <code>T-007</code> Finalize demo slides 🔴 🔄 · 7 days ago",
      "🔄 <b>Doing (1)</b>",
      "▸ <code>T-001</code> Fix login redirect 🔴 🔄 · Fri, Sep 11",
    ]);
  });

  it("escapes the username via esc", () => {
    const tasks = [
      baseTask({ assigneeUsername: "a<b", status: "in_progress", overdue: true, dueDate: "2026-08-25" }),
    ];
    const lines = renderMemberBucketsHtml(tasks, NOW);
    expect(lines[1]).toBe(`👤 <b>@${esc("a<b")}</b>`);
  });

  it("empty input -> the no-open-tasks html line", () => {
    expect(renderMemberBucketsHtml([], NOW)).toEqual(["", NO_OPEN_TASKS_HTML]);
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
  // Issue #210: the queue's distinguishing devices — a rule heavier than
  // the light one used elsewhere in the product, an uppercase heading, a
  // count in that heading, and a quote block giving the section its own
  // vertical rail. Present whether the queue is empty or not.
  it("renders the heavier rule, uppercase heading with count, and a blockquote", () => {
    const tasks = [
      baseTask({ id: 1, status: "in_review", overdue: false }),
      baseTask({ id: 2, status: "in_review", overdue: false }),
    ];
    const lines = renderReviewQueueHtml(tasks, NOW);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe(REVIEW_QUEUE_RULE);
    expect(lines[1]).not.toBe("─────────────────────"); // heavier than tasksPage.ts's light rule
    expect(lines[2]).toBe("👀 <b>FOR REVIEW AND APPROVAL (2)</b>");
    expect(lines[3]).toBe("<blockquote>");
    expect(lines.at(-1)).toBe("</blockquote>");
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
    const lines = renderReviewQueueHtml(tasks, NOW);
    expect(lines[4]).toContain("T-014");
    expect(lines[4]).toContain("Module 3 slide deck");
    expect(lines[4]).toContain("@alice");
    expect(lines[4]).not.toContain("👀");
  });

  // Issue #209: an overdue queued task used to carry both a due date and a
  // trailing ⚠️ flag suffix — a date the reader still had to decode, plus a
  // marker that only restated what the date already implied. The shared
  // date renderer already turns an overdue due date into elapsed time
  // ("4 days ago"), so that alone carries the lateness now; the flag is gone.
  it("renders an overdue task's lateness as elapsed time, with no ⚠️ flag suffix", () => {
    const tasks = [
      baseTask({
        id: 1,
        status: "in_review",
        overdue: true,
        dueDate: "2026-08-28",
      }),
    ];
    const lines = renderReviewQueueHtml(tasks, NOW);
    expect(lines[4]).toContain("4 days ago");
    expect(lines[4]).not.toContain("⚠️");
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
    const lines = renderReviewQueueHtml(tasks, NOW);
    expect(lines[4]).toContain(esc("Test <b>bold</b> & amp"));
    expect(lines[4]).toContain(esc("a<b"));
  });

  it("empty state: renders header with (0) and empty message, still inside the blockquote", () => {
    const lines = renderReviewQueueHtml([], NOW);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe(REVIEW_QUEUE_RULE);
    expect(lines[2]).toBe("👀 <b>FOR REVIEW AND APPROVAL (0)</b>");
    expect(lines[3]).toBe("<blockquote>");
    expect(lines[4]).toBe("<i>No tasks waiting for review right now.</i>");
    expect(lines[5]).toBe("</blockquote>");
  });
});

describe("renderMemberBucketsHtml — de-duplication against the review queue (#210)", () => {
  it("a task that is both Overdue and in review appears exactly once in the whole card: in the queue, not the member's Overdue bucket", () => {
    const tasks = [
      baseTask({
        id: 42,
        title: "Overdue and in review",
        status: "in_review",
        overdue: true,
        dueDate: "2026-08-20",
      }),
    ];
    const memberLines = renderMemberBucketsHtml(tasks, NOW);
    const queueLines = renderReviewQueueHtml(tasks, NOW);

    // Omitted from the member's bucket entirely (falls back to the
    // no-open-tasks line, since this was the member's only task).
    expect(memberLines).toEqual(["", NO_OPEN_TASKS_HTML]);
    expect(memberLines.join("\n")).not.toContain("Overdue and in review");

    // Present exactly once, in the queue.
    expect(queueLines.join("\n").split("Overdue and in review")).toHaveLength(2);
  });

  it("a plain in_review (not overdue) task is omitted from its owner's For approval bucket", () => {
    const tasks = [
      baseTask({ id: 1, title: "Also has doing work", status: "in_progress", overdue: false }),
      baseTask({
        id: 2,
        title: "Needs review",
        status: "in_review",
        overdue: false,
      }),
    ];
    const lines = renderMemberBucketsHtml(tasks, NOW);
    expect(lines.join("\n")).not.toContain("Needs review");
    expect(lines.join("\n")).not.toContain("For approval");
    expect(lines.join("\n")).toContain("Also has doing work");
  });
});
