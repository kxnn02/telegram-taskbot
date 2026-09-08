import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import type { TaskStatus } from "../domain/types.js";
import {
  chunkMessage,
  formatAmbiguousTaskMatches,
  formatApproved,
  formatBatchReply,
  formatDeadlines,
  formatDoneOk,
  formatCompleteOk,
  formatMyTasks,
  formatTaskAdded,
  formatTaskLine,
  formatTaskDetail,
  formatTaskNotFound,
  formatUpdateOk,
  formatWeeklyCompleted,
  formatHelp,
  statusLabel,
  UNKNOWN_COMMAND_REPLY,
  DONE_USAGE,
  COMPLETE_USAGE,
  UPDATE_USAGE,
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
    priority: "medium",
    orderIndex: 0,
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

describe("formatTaskNotFound (issue #124 stage S1, Devie route.ts:952/1012)", () => {
  it("renders the not-found card, HTML-escaping the input", () => {
    expect(formatTaskNotFound(`login <script>`)).toBe(
      [
        `❌ No active task found matching <b>"login &lt;script&gt;"</b>.`,
        "",
        "<i>Use /tasks to see all active tasks.</i>",
      ].join("\n"),
    );
  });
});

describe("formatAmbiguousTaskMatches (issue #124 stage S1, Devie route.ts:957-960/456-460)", () => {
  it("lists up to five candidates with the bare task number and spaced status", () => {
    const matches = [
      task({ id: 22, title: "Login page redesign", status: "in_progress" }),
      task({ id: 21, title: "Fix login bug", status: "todo" }),
    ];
    expect(formatAmbiguousTaskMatches("/done", "login", matches)).toBe(
      [
        `🔍 Multiple tasks matched <b>"login"</b>:`,
        "• <b>22</b> · Login page redesign (in progress)",
        "• <b>21</b> · Fix login bug (todo)",
        "",
        "Please be more specific, or use the task number:",
        "<code>/done &lt;number&gt;</code>",
      ].join("\n"),
    );
  });

  it("HTML-escapes the input and each title", () => {
    const matches = [task({ id: 5, title: "A <b>bold</b> & risky title" })];
    const result = formatAmbiguousTaskMatches("/update", `<i>x</i>`, matches);
    expect(result).toContain(`"&lt;i&gt;x&lt;/i&gt;"`);
    expect(result).toContain("A &lt;b&gt;bold&lt;/b&gt; &amp; risky title");
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

describe("formatWeeklyCompleted (#143 D4b / #147)", () => {
  it("says nothing was completed when the list is empty", () => {
    expect(formatWeeklyCompleted([])).toBe("Nothing completed this week.");
  });

  it("heads the list with a count and lists each task with its marked-done date", () => {
    const text = formatWeeklyCompleted([
      task({
        id: 1,
        title: "Get design from Zendy",
        status: "done",
        previousStatus: null,
        blockedReason: null,
        updatedAt: "2026-09-03T00:00:00.000Z",
      }),
      task({
        id: 4,
        title: "Draft welcome email copy",
        status: "done",
        previousStatus: null,
        blockedReason: null,
        updatedAt: "2026-09-05T00:00:00.000Z",
      }),
    ]);
    expect(text).toBe(
      [
        "✅ Completed this week (2):",
        "- #1 Get design from Zendy (marked done Sep 3)",
        "- #4 Draft welcome email copy (marked done Sep 5)",
      ].join("\n"),
    );
  });

  it("shares no text with formatMyTasks/formatApproved (must read as its own message, not a variant)", () => {
    const tasksList = [
      task({ id: 1, title: "x", status: "done", previousStatus: null, blockedReason: null }),
    ];
    expect(formatWeeklyCompleted(tasksList)).not.toContain("Your open tasks");
    expect(formatWeeklyCompleted(tasksList)).not.toContain("Marked done this past week");
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

  it("renders an urgent task's priority badge with a leading space (issue #101)", () => {
    const text = formatTaskLine(task({ priority: "urgent" }));
    expect(text).toContain("#1 🔴");
  });

  it("renders a high task's priority badge with a leading space", () => {
    const text = formatTaskLine(task({ priority: "high" }));
    expect(text).toContain("#1 🟠");
  });

  it("renders nothing at all for medium priority — absence is the case to assert", () => {
    const text = formatTaskLine(task({ priority: "medium" }));
    expect(text).not.toContain("🔴");
    expect(text).not.toContain("🟠");
    expect(text).toContain(`#1 ${task().title}`);
  });

  it("renders nothing at all for low priority", () => {
    const text = formatTaskLine(task({ priority: "low" }));
    expect(text).not.toContain("🔴");
    expect(text).not.toContain("🟠");
    expect(text).toContain(`#1 ${task().title}`);
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

describe("formatHelp (issue #124 stage S3: Devie's HTML card, verbatim)", () => {
  const EXPECTED = [
    "🤖 <b>Test Bot — Available Commands</b>",
    "",
    "📋 <b>View</b>",
    "/tasks — browse tasks by member (paginated)",
    "/tasks &lt;role&gt; — filter by role (e.g. cohort-5)",
    "/tasks @username — filter by member",
    "/deadlines — show upcoming deadlines",
    "/standup — send the standup report",
    "",
    "➕ <b>Create</b>",
    "/addtask &lt;title&gt; — add a task (defaults to nearest Tue or Thu onsite day)",
    "/addtask &lt;title&gt; by Friday — add a task with a specific deadline",
    "/addtask &lt;title&gt; @username — add a task and assign it to someone",
    '@-mention the bot, "pls work on &lt;title&gt;" — same as /addtask, works in group chats too',
    '@-mention the bot, "add task &lt;title&gt; @username" — tag + assign in one go',
    "",
    "✏️ <b>Update</b>",
    "/done &lt;ref&gt; — mark as in review (e.g. /done 23)",
    "/done t21,t22,t23 — bulk mark as in review",
    "/complete &lt;ref&gt; (or /completed &lt;ref&gt;) — mark as done (e.g. /complete 23)",
    "/complete t21,t22,t23 — bulk mark as done",
    "/update &lt;ref&gt; &lt;status&gt; — single update",
    "/update t21,t22,t23 done — bulk shared status",
    "/update t21 done, t22 review, t23 inprogress — bulk mixed status",
    "/update, one ref+status per line — bulk multiline",
    "",
    "<i>Statuses: backlog · todo · in progress · in review · blocked · done</i>",
  ].join("\n");

  it("matches Devie's card character for character", () => {
    expect(formatHelp("Test Bot")).toBe(EXPECTED);
  });

  it("interpolates whatever display name it's given, unescaped", () => {
    expect(formatHelp("Cohort 5 Bot")).toContain("🤖 <b>Cohort 5 Bot — Available Commands</b>");
  });

  it("has no ⚙️ Other section, no /help or /start line, and no Statuses list section", () => {
    const text = formatHelp("Test Bot");
    expect(text).not.toContain("⚙️");
    expect(text).not.toContain("Other");
    expect(text).not.toMatch(/\/help — this list/);
    expect(text).not.toMatch(/\/start — /);
    expect(text).not.toContain("not yet started");
    expect(text).not.toContain("ready to be picked up");
  });

  it("has no access-control wording of any kind", () => {
    const text = formatHelp("Test Bot").toLowerCase();
    expect(text).not.toContain("higher-up");
    expect(text).not.toContain("intern");
    expect(text).not.toContain("restricted");
  });
});

describe("BOT_COMMANDS / formatHelp coherence", () => {
  it("every command Telegram's autocomplete menu offers, except /start and /help (which Devie's own card omits), also appears in /help", async () => {
    const { BOT_COMMANDS } = await import("./createBot.js");
    const helpText = formatHelp("Test Bot");
    for (const { command } of BOT_COMMANDS) {
      if (command === "start" || command === "help") continue;
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

  it("never splits a message between an opening and closing HTML tag (issue #124 stage S3)", () => {
    // Build a large /update batch reply — the longest target shape — and
    // assert every chunk has balanced <b>/<code>/<i> tags. Every target
    // string in this stage keeps its tags on a single line, so a
    // newline-only splitter can never sever a tag pair.
    const successes = Array.from({ length: 400 }, (_, i) => ({
      ref: `T-${String(i + 1).padStart(3, "0")}`,
      title: `Some task title number ${i}`,
      statusWord: "done",
      emoji: "✅",
    }));
    const text = formatBatchReply("update", successes, []);
    const chunks = chunkMessage(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const tag of ["b", "code", "i"]) {
        const opens = (chunk.match(new RegExp(`<${tag}>`, "g")) ?? []).length;
        const closes = (chunk.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
        expect(opens).toBe(closes);
      }
    }
  });
});

describe("formatTaskAdded (issue #124 stage S3, Devie's taskAddedMsg)", () => {
  it("renders every line when assignee and due date are both present", () => {
    const text = formatTaskAdded({
      id: 42,
      title: "Fix the login bug",
      priority: "medium",
      assigneeUsername: "dale",
      dueDate: "2026-09-09",
    });
    expect(text).toBe(
      [
        "🔵 Task added · Medium:",
        "<b>Fix the login bug</b>",
        "👤 Assigned to: @dale",
        "📅 Due: Sep 9, 2026",
        "🪪 ID: <code>t42</code>",
        "",
        "<i>Refresh the dashboard to see your changes.</i>",
      ].join("\n"),
    );
  });

  it("maps every priority to Devie's PRIORITY_EMOJI dot, not this repo's PRIORITY_BADGE", () => {
    expect(formatTaskAdded({ id: 1, title: "t", priority: "urgent" })).toContain("🔴 Task added · Urgent:");
    expect(formatTaskAdded({ id: 1, title: "t", priority: "high" })).toContain("🟠 Task added · High:");
    expect(formatTaskAdded({ id: 1, title: "t", priority: "medium" })).toContain("🔵 Task added · Medium:");
    expect(formatTaskAdded({ id: 1, title: "t", priority: "low" })).toContain("⚪ Task added · Low:");
  });

  it("omits the Assigned-to line when there is no assignee", () => {
    const text = formatTaskAdded({ id: 1, title: "t", priority: "medium" });
    expect(text).not.toContain("Assigned to");
  });

  it("omits the Due line when there is no due date", () => {
    const text = formatTaskAdded({ id: 1, title: "t", priority: "medium", assigneeUsername: "dale" });
    expect(text).not.toContain("📅 Due");
  });

  it("always renders the lowercase t{id} form, never the T-001 form", () => {
    const text = formatTaskAdded({ id: 7, title: "t", priority: "medium" });
    expect(text).toContain("<code>t7</code>");
    expect(text).not.toContain("T-007");
  });

  it("HTML-escapes a title containing < > &", () => {
    const text = formatTaskAdded({ id: 1, title: "Fix <script> & \"bug\"", priority: "medium" });
    expect(text).toContain("<b>Fix &lt;script&gt; &amp; \"bug\"</b>");
  });
});

describe("formatDoneOk / formatCompleteOk / formatUpdateOk (issue #124 stage S3)", () => {
  it("formatDoneOk", () => {
    expect(formatDoneOk("Fix the login bug")).toBe(
      "👀 <b>Fix the login bug</b>\nMoved to In Review.",
    );
  });

  it("formatCompleteOk", () => {
    expect(formatCompleteOk("Fix the login bug")).toBe(
      "✅ <b>Fix the login bug</b>\nMarked as done. Nice work! 🎉",
    );
  });

  it("formatUpdateOk renders the status emoji and the status word with underscores as spaces", () => {
    expect(formatUpdateOk("Fix the login bug", "in_progress")).toBe(
      "🔄 <b>Fix the login bug</b>\nUpdated to: <b>in progress</b>",
    );
  });

  it("formatUpdateOk covers every status's emoji", () => {
    expect(formatUpdateOk("t", "backlog")).toContain("📦");
    expect(formatUpdateOk("t", "todo")).toContain("📝");
    expect(formatUpdateOk("t", "in_review")).toContain("👀");
    expect(formatUpdateOk("t", "blocked")).toContain("🚧");
    expect(formatUpdateOk("t", "done")).toContain("✅");
  });

  it("HTML-escapes the title in every one of the three", () => {
    const title = "<b>x</b> & y";
    expect(formatDoneOk(title)).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(formatCompleteOk(title)).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(formatUpdateOk(title, "done")).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });
});

describe("formatBatchReply (issue #124 stage S3)", () => {
  it("done batch, singular count", () => {
    const text = formatBatchReply(
      "done",
      [{ ref: "T-001", title: "Fix the login bug", statusWord: "in review", emoji: "👀" }],
      [],
    );
    expect(text).toBe(
      [
        "👀 <b>Moved 1 task to In Review.</b>",
        "• 👀 <code>T-001</code> Fix the login bug → <b>in review</b>",
      ].join("\n"),
    );
  });

  it("done batch, plural count", () => {
    const text = formatBatchReply(
      "done",
      [
        { ref: "T-001", title: "First", statusWord: "in review", emoji: "👀" },
        { ref: "T-002", title: "Second", statusWord: "in review", emoji: "👀" },
      ],
      [],
    );
    expect(text.split("\n")[0]).toBe("👀 <b>Moved 2 tasks to In Review.</b>");
  });

  it("complete batch", () => {
    const text = formatBatchReply(
      "complete",
      [{ ref: "T-001", title: "Fix the login bug", statusWord: "done", emoji: "✅" }],
      [],
    );
    expect(text).toBe(
      [
        "✅ <b>Marked 1 task as done.</b>",
        "• ✅ <code>T-001</code> Fix the login bug → <b>done</b>",
      ].join("\n"),
    );
  });

  it("update batch with a link/note rider rendered as indented sub-lines", () => {
    const text = formatBatchReply(
      "update",
      [
        {
          ref: "T-001",
          title: "Fix the login bug",
          statusWord: "done",
          emoji: "✅",
          metaSuffix: "\n  🔗 https://example.com/pr/1\n  📝 ready for QA",
        },
      ],
      [],
    );
    expect(text).toBe(
      [
        "✅ <b>Updated 1 task.</b>",
        "• ✅ <code>T-001</code> Fix the login bug → <b>done</b>",
        "  🔗 https://example.com/pr/1",
        "  📝 ready for QA",
      ].join("\n"),
    );
  });

  it("HTML-escapes the title of every success line", () => {
    const text = formatBatchReply(
      "update",
      [{ ref: "T-001", title: "<b>x</b> & y", statusWord: "done", emoji: "✅" }],
      [],
    );
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });

  it("a batch with both successes and failures groups failures at the end under a Skipped header", () => {
    const text = formatBatchReply(
      "update",
      [{ ref: "T-001", title: "Fix the login bug", statusWord: "done", emoji: "✅" }],
      [{ ref: "t22", reason: "no active task found" }],
    );
    expect(text).toBe(
      [
        "✅ <b>Updated 1 task.</b>",
        "• ✅ <code>T-001</code> Fix the login bug → <b>done</b>",
        "",
        "⚠️ <b>Skipped 1 item:</b>",
        "• <b>t22</b> → no active task found",
      ].join("\n"),
    );
  });

  it("multiple failures pluralize 'items'", () => {
    const text = formatBatchReply(
      "update",
      [{ ref: "T-001", title: "x", statusWord: "done", emoji: "✅" }],
      [
        { ref: "t22", reason: "no active task found" },
        { ref: "t23", reason: "no active task found" },
      ],
    );
    expect(text).toContain("⚠️ <b>Skipped 2 items:</b>");
  });

  it("all failed: renders the no-tasks-updated block instead of any usage text", () => {
    const text = formatBatchReply(
      "done",
      [],
      [
        { ref: "t21", reason: "no active task found" },
        { ref: "t22", reason: "multiple tasks matched; use task number" },
      ],
    );
    expect(text).toBe(
      [
        "❌ No tasks were updated.",
        "• <b>t21</b> → no active task found",
        "• <b>t22</b> → multiple tasks matched; use task number",
        "",
        "<i>Use /tasks to see valid task numbers.</i>",
      ].join("\n"),
    );
  });

  it("HTML-escapes failure refs and reasons", () => {
    const text = formatBatchReply("done", [], [{ ref: "<x>", reason: "a & b" }]);
    expect(text).toContain("&lt;x&gt;");
    expect(text).toContain("a &amp; b");
  });
});

describe("usage blocks (issue #124 stage S3, Devie's verbatim text)", () => {
  it("DONE_USAGE", () => {
    expect(DONE_USAGE).toBe(
      [
        "Usage: <code>/done &lt;number or keyword&gt;</code>",
        "",
        "<b>Examples:</b>",
        "/done 23",
        "/done login bug",
        "/done t21,t22,t23",
        "",
        "<i>Moves tasks to In Review. Use the task number or any words from the title.</i>",
        "<i>To mark as fully done, use /complete instead.</i>",
      ].join("\n"),
    );
  });

  it("COMPLETE_USAGE", () => {
    expect(COMPLETE_USAGE).toBe(
      [
        "Usage: <code>/complete &lt;number or keyword&gt;</code>",
        "",
        "<b>Examples:</b>",
        "/complete 23",
        "/complete login bug",
        "/complete t21,t22,t23",
        "",
        "<i>Marks tasks as done. Use the task number or any words from the title.</i>",
      ].join("\n"),
    );
  });

  it("UPDATE_USAGE, this repo's longer variant with the link:/note: rider example", () => {
    expect(UPDATE_USAGE).toBe(
      [
        "Usage: <code>/update &lt;number or keyword&gt; &lt;status&gt;</code>",
        "",
        "<b>Examples:</b>",
        "/update 23 in review",
        "/update login blocked",
        "/update t21,t22,t23 done",
        "/update t21 done, t22 review, t23 inprogress",
        "/update t31 done",
        "t30 done",
        "t32 done",
        "/update T-001 done link:https://github.com/... note: ready for QA",
        "",
        "<i>Valid statuses: backlog · todo · in progress · in review · blocked · done</i>",
        "<i>Optionally append <code>link:&lt;url&gt;</code> and/or <code>note:&lt;text&gt;</code>.</i>",
      ].join("\n"),
    );
  });
});

describe("UNKNOWN_COMMAND_REPLY (issue #124 stage S3)", () => {
  it("matches Devie's exact wording", () => {
    expect(UNKNOWN_COMMAND_REPLY).toBe("❓ Unknown command. Try /help to see what's available.");
  });
});
