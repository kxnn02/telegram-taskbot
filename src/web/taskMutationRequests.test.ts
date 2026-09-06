import { describe, expect, it } from "vitest";
import {
  parseCreateTagRequest,
  parseCreateTaskRequest,
  parseDueDateTextRequest,
  parseEditTaskRequest,
  parseReorderRequest,
  parseSetPriorityRequest,
  parseSetTaskTagsRequest,
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

describe("parseReorderRequest (issue #105 sub-stage 5b)", () => {
  it("accepts a valid non-negative integer orderIndex", () => {
    const result = parseReorderRequest({ orderIndex: 3 });
    expect(result).toEqual({ ok: true, value: { orderIndex: 3 } });
  });

  it("accepts zero", () => {
    const result = parseReorderRequest({ orderIndex: 0 });
    expect(result).toEqual({ ok: true, value: { orderIndex: 0 } });
  });

  it("rejects a missing orderIndex", () => {
    const result = parseReorderRequest({});
    expect(result.ok).toBe(false);
  });

  it("rejects a non-number orderIndex", () => {
    const result = parseReorderRequest({ orderIndex: "3" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-integer orderIndex", () => {
    const result = parseReorderRequest({ orderIndex: 1.5 });
    expect(result.ok).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(parseReorderRequest({ orderIndex: NaN }).ok).toBe(false);
    expect(parseReorderRequest({ orderIndex: Infinity }).ok).toBe(false);
  });

  it("rejects a negative orderIndex", () => {
    const result = parseReorderRequest({ orderIndex: -1 });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseReorderRequest(null).ok).toBe(false);
  });
});

describe("parseCreateTagRequest (issue #105 sub-stage 5b)", () => {
  it("accepts a name with no color", () => {
    const result = parseCreateTagRequest({ name: "Backend" });
    expect(result).toEqual({ ok: true, value: { name: "Backend" } });
  });

  it("accepts a name with a valid hex color", () => {
    const result = parseCreateTagRequest({ name: "Backend", color: "#ef4444" });
    expect(result).toEqual({ ok: true, value: { name: "Backend", color: "#ef4444" } });
  });

  it("rejects a missing name", () => {
    expect(parseCreateTagRequest({}).ok).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(parseCreateTagRequest({ name: "   " }).ok).toBe(false);
  });

  it("rejects a malformed hex color", () => {
    expect(parseCreateTagRequest({ name: "Backend", color: "red" }).ok).toBe(false);
    expect(parseCreateTagRequest({ name: "Backend", color: "#fff" }).ok).toBe(false);
    expect(parseCreateTagRequest({ name: "Backend", color: "123456" }).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseCreateTagRequest(null).ok).toBe(false);
  });
});

describe("parseSetTaskTagsRequest (issue #105 sub-stage 5b)", () => {
  it("accepts an array of non-negative integers", () => {
    const result = parseSetTaskTagsRequest({ tagIds: [1, 2, 3] });
    expect(result).toEqual({ ok: true, value: { tagIds: [1, 2, 3] } });
  });

  it("accepts an empty array — means 'no tags'", () => {
    const result = parseSetTaskTagsRequest({ tagIds: [] });
    expect(result).toEqual({ ok: true, value: { tagIds: [] } });
  });

  it("rejects a missing tagIds field", () => {
    expect(parseSetTaskTagsRequest({}).ok).toBe(false);
  });

  it("rejects a non-array tagIds", () => {
    expect(parseSetTaskTagsRequest({ tagIds: "1,2,3" }).ok).toBe(false);
  });

  it("rejects non-integer array elements", () => {
    expect(parseSetTaskTagsRequest({ tagIds: [1, 2.5] }).ok).toBe(false);
    expect(parseSetTaskTagsRequest({ tagIds: [1, "2"] }).ok).toBe(false);
  });

  it("rejects a negative array element", () => {
    expect(parseSetTaskTagsRequest({ tagIds: [1, -2] }).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseSetTaskTagsRequest(null).ok).toBe(false);
  });
});

describe("parseSetPriorityRequest (issue #105 sub-stage 5b — the dashboard's task-dialog priority write path, per taskService.ts's own setPriority doc comment)", () => {
  it("accepts every one of the four priorities", () => {
    for (const priority of ["low", "medium", "high", "urgent"]) {
      expect(parseSetPriorityRequest({ priority })).toEqual({ ok: true, value: { priority } });
    }
  });

  it("rejects a missing priority", () => {
    expect(parseSetPriorityRequest({}).ok).toBe(false);
  });

  it("rejects a priority that isn't one of the four", () => {
    const result = parseSetPriorityRequest({ priority: "urgentest" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("priority");
  });

  it("rejects a non-object body", () => {
    expect(parseSetPriorityRequest(null).ok).toBe(false);
  });
});

// editPatchRequiresHigherUp (and its describe block) was deleted by
// #106/ADR-0013: the dashboard's PATCH /api/tasks/:id route no longer gates
// assignee/title/description/due-date edits on a role, since there is no
// role any more — every roster member can edit every field, same as the
// bot's /update.
