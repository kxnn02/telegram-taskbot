import { describe, expect, it } from "vitest";
import {
  formatBulkCreateReply,
  resolveBulkAssignee,
  shouldTriggerBulkCreate,
  type BulkCreatedTask,
} from "./bulkTaskCreate.js";

// Devie's own gate for handing `/addtask`'s body to the bulk parser instead
// of the single-task grammar (`app/api/telegram/webhook/route.ts:1128-1134`
// @ `632a22c`), ported character-for-character.
describe("shouldTriggerBulkCreate", () => {
  it("is false for an ordinary single-line, single-mention body", () => {
    expect(shouldTriggerBulkCreate("fix the login bug @dale by Friday")).toBe(false);
  });

  it("is false for plain text with no mention, newline, or grouped segment", () => {
    expect(shouldTriggerBulkCreate("fix the login bug by Friday")).toBe(false);
  });

  it("is true when more than one @mention appears", () => {
    expect(shouldTriggerBulkCreate("@dale fix login @kien review PR")).toBe(true);
  });

  it("is true when the body contains a newline", () => {
    expect(shouldTriggerBulkCreate("@dale\nfix login")).toBe(true);
  });

  it("is true for an 'Action Plan:' grouped segment", () => {
    expect(shouldTriggerBulkCreate("@dale Action Plan: present tomorrow")).toBe(true);
  });

  it("is true for a 'Note:' grouped segment", () => {
    expect(shouldTriggerBulkCreate("@dale fix login Note: standby onsite")).toBe(true);
  });

  it("is true for a semicolon-separated list", () => {
    expect(shouldTriggerBulkCreate("@dale fix login; review the PR")).toBe(true);
  });

  // New test cases for issue #188: mention-free multi-paragraph prose
  // should not trigger bulk create (only bullet/numbered lists or
  // multi-mention/structured assignment patterns should).

  it("(case 1) returns false for a 3-paragraph message with no mention", () => {
    expect(
      shouldTriggerBulkCreate(
        `adjust date format if overdue just output x days ago

for upcoming deadlines set to

Day of the week, month date`
      )
    ).toBe(false);
  });

  it("(case 2) returns true for multiple mentions separated by blank lines", () => {
    expect(shouldTriggerBulkCreate("@dom do X\n\n@jedd do Y")).toBe(true);
  });

  it("(case 3) returns true for a mention with a blank-line-separated body", () => {
    expect(shouldTriggerBulkCreate("@dom do X\n\ndo Y")).toBe(true);
  });

  it("(case 4) returns true for a 2+ item bullet list with no mention", () => {
    expect(shouldTriggerBulkCreate("- task one\n- task two")).toBe(true);
  });

  it("(case 5) returns true for a 2+ item numbered list with no mention", () => {
    expect(shouldTriggerBulkCreate("1. one\n2. two")).toBe(true);
  });

  it("(case 6) returns false for a single-item bullet list", () => {
    expect(shouldTriggerBulkCreate("- only one bullet")).toBe(false);
  });

  it("(case 7) returns false for a semicolon-separated list with no mention", () => {
    expect(shouldTriggerBulkCreate("buy milk; buy eggs")).toBe(false);
  });

  it("(case 8) returns true for a semicolon-separated list with a mention", () => {
    expect(shouldTriggerBulkCreate("@dom buy milk; buy eggs")).toBe(true);
  });

  it("(case 9) returns false for a single-line message with no mention", () => {
    expect(shouldTriggerBulkCreate("single task no newline")).toBe(false);
  });

  it("(case 10) returns false for a single-line message with one mention", () => {
    expect(shouldTriggerBulkCreate("@dom single task")).toBe(false);
  });
});

// Devie's bulk insert (`route.ts:1140-1147`): `t.assignee === 'unassigned' ?
// (authorAssignee ?? null) : t.assignee` — the only mapping applied to the
// parser's raw assignee before insert. No roster lookup, no alias table:
// this repo's roster has no separate display-name/alias fields to resolve
// through (every roster entry *is* just a username), so the "alias table,
// then name match" chain issue #104 describes collapses to this.
describe("resolveBulkAssignee", () => {
  it("falls back to the message author when the parser found no @mention at all", () => {
    expect(resolveBulkAssignee("unassigned", "carla")).toBe("carla");
  });

  it("passes through a raw parsed assignee unchanged (normalized)", () => {
    expect(resolveBulkAssignee("dale", "carla")).toBe("dale");
  });

  it("passes through an assignee matching no roster member — an orphan task, on purpose", () => {
    expect(resolveBulkAssignee("notarealperson", "carla")).toBe("notarealperson");
  });

  it("normalizes case the same way the rest of the roster does", () => {
    expect(resolveBulkAssignee("Dale", "carla")).toBe("dale");
  });
});

// Devie's grouped confirmation reply (`route.ts:1152-1163`), copied wording
// and emoji per issue #104's carbon-copy rule 1 — the one place in this bot
// that sends HTML and emoji outside of `/tasks`/`/standup` (#103's existing
// carve-out for a carbon-copied Devie view).
describe("formatBulkCreateReply", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const baseTask: BulkCreatedTask = {
    id: 1,
    title: "Summarize recommendations into slides",
    assigneeUsername: "dale",
    dueDate: "2026-09-05",
    priority: "medium",
  };

  it("uses singular wording for exactly one task", () => {
    const reply = formatBulkCreateReply([baseTask], now);
    expect(reply).toContain("<b>1 task added.</b>");
  });

  it("uses plural wording for more than one task", () => {
    const reply = formatBulkCreateReply([baseTask, { ...baseTask, id: 2 }], now);
    expect(reply).toContain("<b>2 tasks added.</b>");
  });

  it("groups tasks under their assignee, one @-header per group", () => {
    const reply = formatBulkCreateReply(
      [baseTask, { ...baseTask, id: 2, assigneeUsername: "kien", title: "Review PR" }],
      now,
    );
    expect(reply).toContain("@dale");
    expect(reply).toContain("@kien");
  });

  it("renders each task's ref through the shared monospace renderer, title, and due date in short form", () => {
    const reply = formatBulkCreateReply([baseTask], now);
    expect(reply).toContain("<code>T-001</code>");
    expect(reply).toContain("Summarize recommendations into slides");
    expect(reply).toContain("Sep 5");
  });

  it("renders no due-date suffix when the task carries no due date", () => {
    const reply = formatBulkCreateReply([{ ...baseTask, dueDate: undefined }], now);
    expect(reply).not.toContain(" · ");
  });

  it("renders a shared priority badge for urgent, and no dot for medium/low", () => {
    const urgent = formatBulkCreateReply([{ ...baseTask, priority: "urgent" }], now);
    expect(urgent).toContain("🔴");
    const medium = formatBulkCreateReply([{ ...baseTask, priority: "medium" }], now);
    expect(medium).not.toContain("🔴");
    expect(medium).not.toContain("🟠");
  });

  it("flags a task whose description carries a URL", () => {
    const reply = formatBulkCreateReply(
      [{ ...baseTask, description: "https://docs.google.com/doc" }],
      now,
    );
    expect(reply).toContain("🔗");
  });

  it("does not flag a task with no URL in its description", () => {
    const reply = formatBulkCreateReply(
      [{ ...baseTask, description: "just some notes" }],
      now,
    );
    expect(reply).not.toContain("🔗");
  });
});
