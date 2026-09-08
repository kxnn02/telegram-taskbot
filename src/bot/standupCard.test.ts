import { describe, expect, it } from "vitest";
import type { TaskWithFlags } from "../service/taskService.js";
import { greeting, groupByMember, renderByMember, taskLine } from "./standupCard.js";
import { esc } from "./html.js";

// Issue #107: presentation helpers for the standup's "character" — the
// greeting, HTML escaping, and the HTML task-line/member-grouping used by
// the push endpoint's card. Kept in their own module (`standupCard.ts`)
// rather than piled onto `standup.ts`, since these render HTML for the new
// push card while `standup.ts`'s existing formatters stay the plain-text
// `/standup` command output (see this ticket's PR body for why).

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

describe("greeting (Devie's three Manila-hour bands, verbatim strings)", () => {
  const MORNING = "Good morning, team! Let's make today count. 🌅";
  const AFTERNOON = "Good afternoon, team! Here's a quick look at the board. ☀️";
  const EVENING = "Good evening, team! Here's your end-of-day update. 🌙";

  // Manila is UTC+8 with no DST, so 05:00 Manila == 21:00 UTC the previous day, etc.
  const manila = (hour: number) => new Date(`2026-09-01T${String((hour - 8 + 24) % 24).padStart(2, "0")}:00:00.000Z`);

  it("05:00 Manila -> morning", () => {
    expect(greeting(manila(5))).toBe(MORNING);
  });
  it("11:59 Manila -> morning", () => {
    const d = new Date(manila(11).getTime() + 59 * 60 * 1000);
    expect(greeting(d)).toBe(MORNING);
  });
  it("12:00 Manila -> afternoon", () => {
    expect(greeting(manila(12))).toBe(AFTERNOON);
  });
  it("16:59 Manila -> afternoon", () => {
    const d = new Date(manila(16).getTime() + 59 * 60 * 1000);
    expect(greeting(d)).toBe(AFTERNOON);
  });
  it("17:00 Manila -> evening", () => {
    expect(greeting(manila(17))).toBe(EVENING);
  });
  it("23:00 Manila -> evening", () => {
    expect(greeting(manila(23))).toBe(EVENING);
  });
});

describe("esc", () => {
  it("escapes & < > in that order, verbatim to Devie's esc()", () => {
    expect(esc("<b>a & b</b>")).toBe("&lt;b&gt;a &amp; b&lt;/b&gt;");
  });
  it("leaves plain text untouched", () => {
    expect(esc("hello world")).toBe("hello world");
  });
});

describe("taskLine", () => {
  it("with a task code (default): ▸ <code>T-001</code> Title · date", () => {
    const t = baseTask({ id: 1, priority: "low", status: "todo" });
    const line = taskLine(t, { showStatus: false, showDue: true });
    expect(line).toBe("▸ <code>T-001</code> Ship the thing · Sat, Sep 12");
  });

  it("without a task code", () => {
    const t = baseTask();
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Ship the thing");
  });

  it("urgent priority renders a leading-space red circle", () => {
    const t = baseTask({ priority: "urgent" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Ship the thing 🔴");
  });

  it("high priority renders a leading-space orange circle", () => {
    const t = baseTask({ priority: "high" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Ship the thing 🟠");
  });

  it("medium priority adds nothing", () => {
    const t = baseTask({ priority: "medium" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Ship the thing");
  });

  it("low priority adds nothing", () => {
    const t = baseTask({ priority: "low" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Ship the thing");
  });

  it("showStatus on appends the status emoji", () => {
    const t = baseTask({ status: "blocked" });
    const line = taskLine(t, { showCode: false, showStatus: true, showDue: false });
    expect(line).toBe("▸ Ship the thing 🚧");
  });

  it("showStatus off omits the status emoji", () => {
    const t = baseTask({ status: "blocked" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Ship the thing");
  });

  it("with a due date", () => {
    const t = baseTask({ dueDate: "2026-09-12" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: true });
    expect(line).toBe("▸ Ship the thing · Sat, Sep 12");
  });

  it("without a due date", () => {
    const t = baseTask({ dueDate: "2026-09-12" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Ship the thing");
  });

  it("escapes < > & in a task title", () => {
    const t = baseTask({ title: "Fix <script> & \"bug\"" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Fix &lt;script&gt; &amp; \"bug\"");
  });

  it("appends the blocked reason for a blocked task", () => {
    const t = baseTask({
      id: 3,
      status: "blocked",
      blockedReason: "waiting on Figma access",
      dueDate: "2026-09-04",
    });
    const line = taskLine(t, { showStatus: true, showDue: true });
    expect(line).toBe(
      "▸ <code>T-003</code> Ship the thing 🚧 · Fri, Sep 4 — <i>waiting on Figma access</i>",
    );
  });

  it("renders a blocked task with no reason exactly as before", () => {
    const t = baseTask({ id: 3, status: "blocked", blockedReason: null, dueDate: "2026-09-04" });
    const line = taskLine(t, { showStatus: true, showDue: true });
    expect(line).toBe("▸ <code>T-003</code> Ship the thing 🚧 · Fri, Sep 4");
  });

  it("never appends a reason to a task that is not blocked", () => {
    const t = baseTask({ status: "todo", blockedReason: "stale reason from an old block" });
    const line = taskLine(t, { showCode: false, showStatus: false, showDue: false });
    expect(line).toBe("▸ Ship the thing");
  });

  it("escapes HTML in the reason", () => {
    const t = baseTask({
      id: 3,
      status: "blocked",
      blockedReason: "blocked by <b>vendor</b> & co",
      dueDate: "2026-09-04",
    });
    const line = taskLine(t, { showStatus: true, showDue: true });
    expect(line).toBe(
      "▸ <code>T-003</code> Ship the thing 🚧 · Fri, Sep 4 — <i>blocked by &lt;b&gt;vendor&lt;/b&gt; &amp; co</i>",
    );
  });
});

describe("groupByMember / renderByMember", () => {
  it("groups alphabetically by assignee username", () => {
    const tasks = [
      baseTask({ id: 1, assigneeUsername: "carla" }),
      baseTask({ id: 2, assigneeUsername: "alice" }),
      baseTask({ id: 3, assigneeUsername: "bob" }),
    ];
    const groups = groupByMember(tasks);
    expect(groups.map((g) => g.username)).toEqual(["alice", "bob", "carla"]);
  });

  it("a single member yields one group", () => {
    const tasks = [baseTask({ id: 1, assigneeUsername: "alice" })];
    expect(groupByMember(tasks).map((g) => g.username)).toEqual(["alice"]);
  });

  it("nobody yields no groups", () => {
    expect(groupByMember([])).toEqual([]);
  });

  it("renderByMember renders a 👤 heading per member then one taskLine per task", () => {
    const tasks = [
      baseTask({ id: 1, assigneeUsername: "alice", title: "Alice task" }),
      baseTask({ id: 2, assigneeUsername: "bob", title: "Bob task" }),
    ];
    const text = renderByMember(tasks, { showCode: false, showStatus: false, showDue: false });
    expect(text).toBe(
      "\n👤 <b>@alice</b>\n▸ Alice task\n\n👤 <b>@bob</b>\n▸ Bob task",
    );
  });
});
