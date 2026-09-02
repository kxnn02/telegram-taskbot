import { describe, expect, it } from "vitest";
import {
  editPatchRequiresHigherUp,
  parseCreateTaskRequest,
  parseDueDateTextRequest,
  parseEditTaskRequest,
} from "./taskMutationRequests.js";

/**
 * Request-parsing/validation for the Next.js task-mutation API routes
 * (Phase 6.2, issue #17). These functions only check that an incoming JSON
 * body is *structurally* well-formed (right fields, right types) before
 * handing it to `TaskService` — they must never duplicate a business rule
 * TaskService already owns (non-empty title, valid due date, intern-only
 * assignee, etc.), only guard against a malformed/missing field reaching
 * the service layer as `undefined` or the wrong type.
 */

describe("parseDueDateTextRequest", () => {
  it("accepts a body with a non-empty text field", () => {
    const result = parseDueDateTextRequest({ text: "next Friday" });
    expect(result).toEqual({ ok: true, value: { text: "next Friday" } });
  });

  it("rejects a missing text field", () => {
    const result = parseDueDateTextRequest({});
    expect(result.ok).toBe(false);
  });

  it("rejects a non-string text field", () => {
    const result = parseDueDateTextRequest({ text: 123 });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = parseDueDateTextRequest({ text: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseDueDateTextRequest(null).ok).toBe(false);
    expect(parseDueDateTextRequest("nope").ok).toBe(false);
    expect(parseDueDateTextRequest(undefined).ok).toBe(false);
  });
});

describe("parseCreateTaskRequest", () => {
  const validBody = {
    assigneeUsername: "alice",
    title: "Write the report",
    description: "Cover Q3 numbers",
    dueDate: "2026-09-05",
  };

  it("accepts a fully-populated body", () => {
    const result = parseCreateTaskRequest(validBody);
    expect(result).toEqual({ ok: true, value: validBody });
  });

  it("rejects a body missing a required field", () => {
    const { title: _title, ...rest } = validBody;
    const result = parseCreateTaskRequest(rest);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("title");
  });

  it("rejects a body with a non-string field", () => {
    const result = parseCreateTaskRequest({ ...validBody, dueDate: 20260905 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("dueDate");
  });

  it("rejects a non-object body", () => {
    expect(parseCreateTaskRequest(null).ok).toBe(false);
    expect(parseCreateTaskRequest([]).ok).toBe(false);
  });
});

describe("parseEditTaskRequest", () => {
  it("accepts an empty body as an empty patch", () => {
    const result = parseEditTaskRequest({});
    expect(result).toEqual({ ok: true, value: {} });
  });

  it("accepts a partial patch with only some fields", () => {
    const result = parseEditTaskRequest({ title: "New title" });
    expect(result).toEqual({ ok: true, value: { title: "New title" } });
  });

  it("accepts a full patch", () => {
    const body = {
      assigneeUsername: "bob",
      title: "New title",
      description: "New description",
      dueDate: "2026-10-01",
    };
    const result = parseEditTaskRequest(body);
    expect(result).toEqual({ ok: true, value: body });
  });

  it("rejects a field present with the wrong type", () => {
    const result = parseEditTaskRequest({ dueDate: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("dueDate");
  });

  it("ignores unknown fields rather than rejecting them", () => {
    const result = parseEditTaskRequest({ title: "ok", somethingElse: "ignored" });
    expect(result).toEqual({ ok: true, value: { title: "ok" } });
  });

  it("rejects a non-object body", () => {
    expect(parseEditTaskRequest(null).ok).toBe(false);
    expect(parseEditTaskRequest("nope").ok).toBe(false);
  });

  it("accepts an optional status field alongside the other fields (issue #27/#29)", () => {
    const result = parseEditTaskRequest({ status: "in_review" });
    expect(result).toEqual({ ok: true, value: { status: "in_review" } });
  });

  it("accepts every one of the six statuses", () => {
    for (const status of ["backlog", "todo", "in_progress", "in_review", "blocked", "done"]) {
      expect(parseEditTaskRequest({ status })).toEqual({ ok: true, value: { status } });
    }
  });

  it("rejects a status that isn't one of the six", () => {
    const result = parseEditTaskRequest({ status: "Approved" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("status");
  });

  it("combines a status change with other field edits in one patch", () => {
    const result = parseEditTaskRequest({ title: "New title", status: "done" });
    expect(result).toEqual({ ok: true, value: { title: "New title", status: "done" } });
  });
});

/**
 * R6/#91 sweep: the bot's `/edit <task_id>` command (`createBot.ts`,
 * `bot.command("edit", ...)`) is higher-up-only, checked before it ever
 * calls `TaskService.editTask` — `editTask` itself deliberately has no role
 * check (`taskService.test.ts`'s "lets any roster member edit a task, no
 * role check"), since every other caller of it already gates at the
 * command layer. The dashboard's `PATCH /api/tasks/:id` is the equivalent
 * entry point for those same four fields (assignee/title/description/due
 * date), so it needs the same gate — this function is what decides whether
 * a given patch needs it. A status-only patch (the row's inline status
 * dropdown, mirroring `/update`, not `/edit`) must NOT require it — #27/#28
 * intentionally opened status changes to every roster member.
 */
describe("editPatchRequiresHigherUp", () => {
  it("is false for an empty patch (a pure status change carries no edit fields)", () => {
    expect(editPatchRequiresHigherUp({})).toBe(false);
  });

  it("is false for a patch that only sets status", () => {
    expect(editPatchRequiresHigherUp({ status: "done" })).toBe(false);
  });

  it("is true when the patch touches title", () => {
    expect(editPatchRequiresHigherUp({ title: "New title" })).toBe(true);
  });

  it("is true when the patch touches assigneeUsername", () => {
    expect(editPatchRequiresHigherUp({ assigneeUsername: "bob" })).toBe(true);
  });

  it("is true when the patch touches description", () => {
    expect(editPatchRequiresHigherUp({ description: "New description" })).toBe(true);
  });

  it("is true when the patch touches dueDate", () => {
    expect(editPatchRequiresHigherUp({ dueDate: "2026-10-01" })).toBe(true);
  });

  it("is true when an edit field is combined with a status change", () => {
    expect(editPatchRequiresHigherUp({ title: "New title", status: "done" })).toBe(true);
  });
});
