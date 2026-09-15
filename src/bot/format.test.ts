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
  formatDueOk,
  formatMyTasks,
  formatTaskAdded,
  formatTaskDetail,
  formatTaskNotFound,
  formatUpdateOk,
  formatWeeklyCompleted,
  formatHelp,
  formatStart,
  statusLabel,
  UNKNOWN_COMMAND_REPLY,
  DONE_USAGE,
  COMPLETE_USAGE,
  UPDATE_USAGE,
  DUE_USAGE,
} from "./format.js";
import { formatTaskRefHtml } from "./taskRef.js";

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
        `❌ No open task found matching <b>"login &lt;script&gt;"</b>.`,
        "",
        "<i>Use /tasks to see all open tasks.</i>",
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

describe("formatMyTasks (issue #206 — shared vocabulary, short form)", () => {
  const NOW = new Date("2026-08-25T02:00:00.000Z");

  it("says no open tasks when the list is empty, per the shared empty-state shape", () => {
    expect(formatMyTasks([], NOW)).toBe("No open tasks.");
  });

  it("renders the shared identifier, priority badge, status and short due-date form, HTML-escaping the title", () => {
    const text = formatMyTasks(
      [
        task({
          id: 1,
          title: "<b>fix</b> & ship",
          dueDate: "2026-09-01",
          status: "todo",
          previousStatus: null,
          blockedReason: null,
          priority: "high",
        }),
      ],
      NOW,
    );
    expect(text).toBe(
      [
        "Your open tasks:",
        "• <code>T-001</code> 🟠 &lt;b&gt;fix&lt;/b&gt; &amp; ship — 📝 To Do (due Tue, Sep 1)",
      ].join("\n"),
    );
  });

  it("shows no pagination footer when everything fits on one page", () => {
    const text = formatMyTasks(tasks(10), NOW);
    expect(text).not.toMatch(/Page \d+ of \d+/);
    expect(text).toContain("T-001");
    expect(text).toContain("T-010");
  });

  it("splits into pages of 10 once the list exceeds the page size", () => {
    const text = formatMyTasks(tasks(11), NOW);
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("/tasks");
    expect(text).not.toContain("/mytasks");
    expect(text).toContain("T-001");
    expect(text).toContain("T-010");
    expect(text).not.toContain("T-011");
  });

  it("returns the requested page's slice", () => {
    const text = formatMyTasks(tasks(11), NOW, 2);
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("T-011");
    expect(text).not.toContain("T-010");
  });
});

describe("formatDeadlines (issue #205 — grouped by day, shared vocabulary)", () => {
  const NOW = new Date("2026-08-25T02:00:00.000Z");

  it("says no deadlines are due when the list is empty, per the shared empty-state shape", () => {
    expect(formatDeadlines([], NOW)).toBe("No deadlines due in the next 7 days.");
  });

  it("HTML-escapes the title", () => {
    const text = formatDeadlines(
      [
        task({
          id: 1,
          title: "<b>fix</b> & ship",
          dueDate: "2026-09-01",
          status: "todo",
          previousStatus: null,
          blockedReason: null,
        }),
      ],
      NOW,
    );
    expect(text).toContain("&lt;b&gt;fix&lt;/b&gt; &amp; ship");
    expect(text).not.toContain("<b>fix</b>");
  });

  it("groups tasks under one day heading each, in the order given, with bare handles and no per-line status", () => {
    const text = formatDeadlines(
      [
        task({
          id: 1,
          title: "sooner",
          dueDate: "2026-09-01",
          status: "todo",
          previousStatus: null,
          blockedReason: null,
          priority: "high",
        }),
        task({
          id: 2,
          title: "also sooner",
          dueDate: "2026-09-01",
          status: "in_progress",
          previousStatus: null,
          blockedReason: null,
        }),
        task({
          id: 3,
          title: "later",
          dueDate: "2026-09-05",
          status: "todo",
          previousStatus: null,
          blockedReason: null,
        }),
      ],
      NOW,
    );
    expect(text).toBe(
      [
        "Due in the next 7 days:",
        "",
        "<b>Tue, Sep 1</b>",
        "• <code>T-001</code> 🟠 sooner — @alice",
        "• <code>T-002</code> also sooner — @alice",
        "",
        "<b>Sat, Sep 5</b>",
        "• <code>T-003</code> later — @alice",
      ].join("\n"),
    );
  });
});

describe("formatApproved", () => {
  it("says no tasks were approved when the list is empty, per the shared empty-state shape", () => {
    expect(formatApproved([])).toBe("No tasks approved in the past week.");
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
  it("says nothing was completed when the list is empty, per the shared empty-state shape", () => {
    expect(formatWeeklyCompleted([])).toBe("No tasks completed this week.");
  });

  it("heads the list with a count and lists each task with the shared identifier and its marked-done date", () => {
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
        "• <code>T-001</code> Get design from Zendy (marked done Sep 3)",
        "• <code>T-004</code> Draft welcome email copy (marked done Sep 5)",
      ].join("\n"),
    );
  });

  it("HTML-escapes the title and renders the priority badge", () => {
    const text = formatWeeklyCompleted([
      task({
        id: 2,
        title: "<b>fix</b> & ship",
        status: "done",
        previousStatus: null,
        blockedReason: null,
        priority: "urgent",
        updatedAt: "2026-09-03T00:00:00.000Z",
      }),
    ]);
    expect(text).toBe(
      "✅ Completed this week (1):\n• <code>T-002</code> 🔴 &lt;b&gt;fix&lt;/b&gt; &amp; ship (marked done Sep 3)",
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
      todo: "To Do",
      in_progress: "In Progress",
      in_review: "In Review",
      blocked: "Blocked",
      done: "Done",
    };
    for (const [status, label] of Object.entries(expected)) {
      expect(statusLabel(status as TaskStatus)).toBe(label);
    }
  });
});

describe("formatTaskDetail", () => {
  it("renders the display label in the Status line", () => {
    const text = formatTaskDetail(task({ status: "in_review", previousStatus: null, blockedReason: null }));
    expect(text).toContain("Status: In Review");
  });

  it("says no notes when there are none, per the shared empty-state shape (no trailing 'yet')", () => {
    const text = formatTaskDetail(task({ notes: [] }));
    expect(text).toContain("No notes.");
    expect(text).not.toContain("No notes yet.");
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
    "/done &lt;ref&gt; — mark as in review (e.g. /done <code>T-023</code>)",
    "/complete &lt;ref&gt; (or /completed &lt;ref&gt;) — mark as done",
    "/update &lt;ref&gt; &lt;status&gt; — single update",
    "/done, /complete and /update all accept a comma- or newline-separated list of refs for bulk updates (e.g. /done <code>T-021</code>,<code>T-022</code>,<code>T-023</code>)",
    "⚠️ /done marks In Review, not Done — use /complete to mark a task actually finished.",
    "/due &lt;ref&gt; [by] &lt;date&gt; — change a task's deadline (e.g. /due 23 friday)",
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

describe("formatStart (issue #211: a real onboarding message, not a /help alias)", () => {
  it("differs from formatHelp", () => {
    expect(formatStart("Test Bot")).not.toBe(formatHelp("Test Bot"));
  });

  it("names three commands a new member can try immediately", () => {
    const text = formatStart("Test Bot");
    expect(text).toContain("/addtask");
    expect(text).toContain("/tasks");
    expect(text).toContain("/done");
  });

  it("states that the bot DMs on assignment and posts a standup each morning", () => {
    const text = formatStart("Test Bot").toLowerCase();
    expect(text).toContain("dm");
    expect(text).toContain("assign");
    expect(text).toContain("standup");
    expect(text).toContain("morning");
  });

  it("points at /help for the full list", () => {
    expect(formatStart("Test Bot")).toContain("/help");
  });

  it("uses the shared monospace task-identifier vocabulary in its example", () => {
    expect(formatStart("Test Bot")).toContain("<code>T-023</code>");
  });

  it("interpolates whatever display name it's given, unescaped", () => {
    expect(formatStart("Cohort 5 Bot")).toContain("Cohort 5 Bot");
  });

  it("has no access-control wording of any kind", () => {
    const text = formatStart("Test Bot").toLowerCase();
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
      changeWord: "done",
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

  it("never splits inside a <blockquote> region, even when the region alone forces an over-limit chunk (issue #210)", () => {
    // A standup-shaped card: some lines above the review queue, then a
    // <blockquote> region long enough on its own to cross the limit,
    // followed by more content after it closes.
    const before = Array.from({ length: 20 }, (_, i) => `Above line ${i} padded out a bit`).join("\n");
    const blockquoteBody = Array.from({ length: 150 }, (_, i) => `Queued task ${i} padded out to add length`).join("\n");
    const after = Array.from({ length: 20 }, (_, i) => `Below line ${i} padded out a bit`).join("\n");
    const text = [before, "<blockquote>", blockquoteBody, "</blockquote>", after].join("\n");

    const chunks = chunkMessage(text, 4000);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const opens = (chunk.match(/<blockquote>/g) ?? []).length;
      const closes = (chunk.match(/<\/blockquote>/g) ?? []).length;
      expect(opens).toBe(closes);
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("ordinary text with no <blockquote> still chunks exactly as before (no behavior change for a normal cohort)", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Task #${i} — some line of text to pad it out`);
    const text = lines.join("\n");

    const chunks = chunkMessage(text, 4000);

    expect(chunks.join("\n")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });
});

describe("formatTaskAdded (issue #207 — shared vocabulary: shared identifier renderer, shared priority table, long-form due date)", () => {
  const NOW = new Date("2026-09-09T12:00:00Z");

  it("renders every line when assignee and due date are both present", () => {
    const text = formatTaskAdded(
      {
        id: 42,
        title: "Fix the login bug",
        priority: "medium",
        assigneeUsername: "dale",
        dueDate: "2026-09-10",
      },
      NOW,
    );
    expect(text).toBe(
      [
        "Task added · Medium:",
        "<b>Fix the login bug</b>",
        "👤 Assigned to: @dale",
        "📅 Due: tomorrow",
        `🪪 ID: ${formatTaskRefHtml(42)}`,
        "",
        "<i>Refresh the dashboard to see your changes.</i>",
      ].join("\n"),
    );
  });

  it("renders the due date in long form (weekday + month name), via the shared renderer", () => {
    const text = formatTaskAdded(
      { id: 1, title: "t", priority: "medium", dueDate: "2026-09-25" },
      NOW,
    );
    expect(text).toContain("📅 Due: Friday, September 25");
  });

  it("follows the shared priority table: urgent and high carry a dot, medium and low carry none", () => {
    expect(formatTaskAdded({ id: 1, title: "t", priority: "urgent" }, NOW)).toContain(
      "Task added 🔴 · Urgent:",
    );
    expect(formatTaskAdded({ id: 1, title: "t", priority: "high" }, NOW)).toContain(
      "Task added 🟠 · High:",
    );
    expect(formatTaskAdded({ id: 1, title: "t", priority: "medium" }, NOW)).toContain(
      "Task added · Medium:",
    );
    expect(formatTaskAdded({ id: 1, title: "t", priority: "low" }, NOW)).toContain(
      "Task added · Low:",
    );
  });

  it("omits the Assigned-to line when there is no assignee", () => {
    const text = formatTaskAdded({ id: 1, title: "t", priority: "medium" }, NOW);
    expect(text).not.toContain("Assigned to");
  });

  it("omits the Due line when there is no due date", () => {
    const text = formatTaskAdded(
      { id: 1, title: "t", priority: "medium", assigneeUsername: "dale" },
      NOW,
    );
    expect(text).not.toContain("📅 Due");
  });

  it("renders the identifier through the shared monospace T-0xx renderer, not the lowercase t{id} form", () => {
    const text = formatTaskAdded({ id: 7, title: "t", priority: "medium" }, NOW);
    expect(text).toContain(formatTaskRefHtml(7));
    expect(text).not.toContain("<code>t7</code>");
  });

  it("HTML-escapes a title containing < > &", () => {
    const text = formatTaskAdded(
      { id: 1, title: "Fix <script> & \"bug\"", priority: "medium" },
      NOW,
    );
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

  it("issue #207: /done and /update <ref> review produce an identical confirmation sentence and leading emoji", () => {
    expect(formatUpdateOk("Fix the login bug", "in_review")).toBe(
      formatDoneOk("Fix the login bug"),
    );
  });
});

describe("formatDueOk (issue #222)", () => {
  const NOW = new Date("2026-09-09T12:00:00Z");

  it("names the task title and renders the new deadline in long form, same '📅 Due:' vocabulary as formatTaskAdded", () => {
    expect(formatDueOk("Fix the login bug", "2026-09-25", NOW)).toBe(
      "✏️ <b>Fix the login bug</b>\n📅 Due: Friday, September 25",
    );
  });

  it("HTML-escapes the title", () => {
    expect(formatDueOk("<b>x</b> & y", "2026-09-25", NOW)).toContain(
      "&lt;b&gt;x&lt;/b&gt; &amp; y",
    );
  });
});

describe("formatBatchReply (issue #124 stage S3)", () => {
  it("done batch, singular count", () => {
    const text = formatBatchReply(
      "done",
      [{ ref: "T-001", title: "Fix the login bug", changeWord: "in review", emoji: "👀" }],
      [],
    );
    expect(text).toBe(
      [
        "👀 <b>Moved 1 task to In Review.</b>",
        "• 👀 <code>T-001</code> Fix the login bug",
      ].join("\n"),
    );
  });

  it("done batch, plural count", () => {
    const text = formatBatchReply(
      "done",
      [
        { ref: "T-001", title: "First", changeWord: "in review", emoji: "👀" },
        { ref: "T-002", title: "Second", changeWord: "in review", emoji: "👀" },
      ],
      [],
    );
    expect(text.split("\n")[0]).toBe("👀 <b>Moved 2 tasks to In Review.</b>");
  });

  it("complete batch", () => {
    const text = formatBatchReply(
      "complete",
      [{ ref: "T-001", title: "Fix the login bug", changeWord: "done", emoji: "✅" }],
      [],
    );
    expect(text).toBe(
      [
        "✅ <b>Marked 1 task as done.</b>",
        "• ✅ <code>T-001</code> Fix the login bug",
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
          changeWord: "done",
          emoji: "✅",
          metaSuffix: "\n  🔗 https://example.com/pr/1\n  📝 ready for QA",
        },
      ],
      [],
    );
    expect(text).toBe(
      [
        "✅ <b>Updated 1 task to done.</b>",
        "• ✅ <code>T-001</code> Fix the login bug",
        "  🔗 https://example.com/pr/1",
        "  📝 ready for QA",
      ].join("\n"),
    );
  });

  it("HTML-escapes the title of every success line", () => {
    const text = formatBatchReply(
      "update",
      [{ ref: "T-001", title: "<b>x</b> & y", changeWord: "done", emoji: "✅" }],
      [],
    );
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });

  it("a batch with both successes and failures groups failures at the end under a Skipped header", () => {
    const text = formatBatchReply(
      "update",
      [{ ref: "T-001", title: "Fix the login bug", changeWord: "done", emoji: "✅" }],
      [{ ref: "t22", reason: "no active task found" }],
    );
    expect(text).toBe(
      [
        "✅ <b>Updated 1 task to done.</b>",
        "• ✅ <code>T-001</code> Fix the login bug",
        "",
        "⚠️ <b>Skipped 1 item:</b>",
        "• <b>t22</b> → no active task found",
      ].join("\n"),
    );
  });

  it("multiple failures pluralize 'items'", () => {
    const text = formatBatchReply(
      "update",
      [{ ref: "T-001", title: "x", changeWord: "done", emoji: "✅" }],
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

  it("issue #207: a single-status bulk reply omits the trailing status on each line", () => {
    const text = formatBatchReply(
      "update",
      [
        { ref: "T-001", title: "First", changeWord: "done", emoji: "✅" },
        { ref: "T-002", title: "Second", changeWord: "done", emoji: "✅" },
      ],
      [],
    );
    expect(text).toBe(
      [
        "✅ <b>Updated 2 tasks to done.</b>",
        "• ✅ <code>T-001</code> First",
        "• ✅ <code>T-002</code> Second",
      ].join("\n"),
    );
  });

  it("issue #207: a mixed-status bulk update retains the trailing status on every line", () => {
    const text = formatBatchReply(
      "update",
      [
        { ref: "T-001", title: "First", changeWord: "done", emoji: "✅" },
        { ref: "T-002", title: "Second", changeWord: "in review", emoji: "👀" },
      ],
      [],
    );
    expect(text).toBe(
      [
        "✅ <b>Updated 2 tasks.</b>",
        "• ✅ <code>T-001</code> First → <b>done</b>",
        "• 👀 <code>T-002</code> Second → <b>in review</b>",
      ].join("\n"),
    );
  });

  it("issue #207: /done and /complete batches (always single-status) also omit the trailing status", () => {
    const text = formatBatchReply(
      "done",
      [
        { ref: "T-001", title: "First", changeWord: "in review", emoji: "👀" },
        { ref: "T-002", title: "Second", changeWord: "in review", emoji: "👀" },
      ],
      [],
    );
    expect(text).toBe(
      [
        "👀 <b>Moved 2 tasks to In Review.</b>",
        "• 👀 <code>T-001</code> First",
        "• 👀 <code>T-002</code> Second",
      ].join("\n"),
    );
  });

  it("issue #207: a single-success update batch still retains a link/note rider suffix", () => {
    const text = formatBatchReply(
      "update",
      [
        {
          ref: "T-001",
          title: "Fix the login bug",
          changeWord: "done",
          emoji: "✅",
          metaSuffix: "\n  🔗 https://example.com/pr/1",
        },
      ],
      [],
    );
    expect(text).toBe(
      [
        "✅ <b>Updated 1 task to done.</b>",
        "• ✅ <code>T-001</code> Fix the login bug",
        "  🔗 https://example.com/pr/1",
      ].join("\n"),
    );
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

  it("UPDATE_USAGE, trimmed (issue #208) with the multiline bulk example labelled as one message", () => {
    expect(UPDATE_USAGE).toBe(
      [
        "Usage: <code>/update &lt;number or keyword&gt; &lt;status&gt;</code>",
        "",
        "<b>Examples:</b>",
        "/update 23 in review",
        "/update t21,t22,t23 done",
        "/update T-001 done link:https://github.com/... note: ready for QA",
        "",
        "<b>Or, one status per line in a single message:</b>",
        "t31 done",
        "t30 done",
        "t32 done",
        "",
        "<i>Valid statuses: backlog · todo · in progress · in review · blocked · done</i>",
        "<i>Optionally append <code>link:&lt;url&gt;</code> and/or <code>note:&lt;text&gt;</code>.</i>",
      ].join("\n"),
    );
  });

  it("DUE_USAGE (issue #222)", () => {
    expect(DUE_USAGE).toBe(
      [
        "Usage: <code>/due &lt;number or keyword&gt; [by] &lt;date&gt;</code>",
        "",
        "<b>Examples:</b>",
        "/due t21 friday",
        "/due t21 by next monday",
        "/due 23 sept 30",
        "/due login bug friday",
        "",
        "<i>Sets a task's due date. The word \"by\" is optional.</i>",
      ].join("\n"),
    );
  });
});

describe("UNKNOWN_COMMAND_REPLY (issue #208 — shared failure marker)", () => {
  it("carries the shared failure marker, not the removed ❓ prefix", () => {
    expect(UNKNOWN_COMMAND_REPLY).toBe("❌ Unknown command. Try /help to see what's available.");
  });
});
