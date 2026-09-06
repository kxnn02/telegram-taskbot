import type { AssignTaskInput, EditTaskInput } from "../service/taskService.js";
import type { TaskPriority, TaskStatus } from "../domain/types.js";

/**
 * Request-parsing/validation for the Next.js task-mutation API routes
 * (Phase 6.2, issue #17). Every mutation Route Handler
 * (`app/api/tasks/**`) delegates the actual body-shape check here before
 * calling into `TaskService` — these functions only guard that an incoming
 * JSON body is *structurally* well-formed (the right fields present, the
 * right types), never a business rule. Business validation (non-empty
 * title, a valid ISO due date, the assignee being a known intern, status-
 * transition legality, etc.) all still lives in `taskService.ts` and is
 * deliberately not duplicated here.
 */

export type ParsedRequest<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): ParsedRequest<T> {
  return { ok: false, error };
}

function asRecord(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  return body as Record<string, unknown>;
}

export function parseDueDateTextRequest(body: unknown): ParsedRequest<{ text: string }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const text = record.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return fail(`"text" is required and must be a non-empty string.`);
  }
  return { ok: true, value: { text } };
}

const CREATE_TASK_FIELDS: Array<keyof AssignTaskInput> = [
  "assigneeUsername",
  "title",
  "description",
  "dueDate",
];

export function parseCreateTaskRequest(body: unknown): ParsedRequest<AssignTaskInput> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  for (const field of CREATE_TASK_FIELDS) {
    if (typeof record[field] !== "string") {
      return fail(`"${field}" is required and must be a string.`);
    }
  }

  return {
    ok: true,
    value: {
      assigneeUsername: record.assigneeUsername as string,
      title: record.title as string,
      description: record.description as string,
      dueDate: record.dueDate as string,
    },
  };
}

const EDIT_TASK_FIELDS: Array<keyof EditTaskInput> = [
  "assigneeUsername",
  "title",
  "description",
  "dueDate",
];

const VALID_STATUSES: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
];

/** `EditTaskInput` plus an optional `status` — kept separate from
 * `TaskService.EditTaskInput` itself (untouched here, per stage 1a) since a
 * status change is dispatched through `TaskService.setStatus` rather than
 * `editTask` (issue #27/#29's PATCH extension). */
export type EditTaskRequestBody = EditTaskInput & { status?: TaskStatus };

export function parseEditTaskRequest(body: unknown): ParsedRequest<EditTaskRequestBody> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const patch: EditTaskRequestBody = {};
  for (const field of EDIT_TASK_FIELDS) {
    if (!(field in record)) continue;
    const value = record[field];
    if (typeof value !== "string") {
      return fail(`"${field}" must be a string if provided.`);
    }
    patch[field] = value;
  }
  if ("status" in record) {
    const value = record.status;
    if (typeof value !== "string" || !VALID_STATUSES.includes(value as TaskStatus)) {
      return fail(`"status" must be one of ${VALID_STATUSES.join(", ")}.`);
    }
    patch.status = value as TaskStatus;
  }
  return { ok: true, value: patch };
}

const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

/** The dashboard's task-dialog priority write path (issue #105 sub-stage
 * 5b) — not in the ticket's original explicit route list, but clearly
 * anticipated by `TaskService.setPriority`'s own doc comment ("this is the
 * parser's (#102) and the dashboard's (#105) write path"), and needed for
 * the ported `task-dialog.tsx`'s priority `<Select>` to actually persist a
 * change on an existing task (priority is deliberately excluded from
 * `editTask`'s patch per #106/ADR-0013, so `PATCH /api/tasks/[id]` can't
 * carry it). A conservative, minimal addition: same thin-route pattern as
 * `parseReorderRequest`. */
export function parseSetPriorityRequest(body: unknown): ParsedRequest<{ priority: TaskPriority }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const priority = record.priority;
  if (typeof priority !== "string" || !VALID_PRIORITIES.includes(priority as TaskPriority)) {
    return fail(`"priority" must be one of ${VALID_PRIORITIES.join(", ")}.`);
  }
  return { ok: true, value: { priority: priority as TaskPriority } };
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Board additions (issue #105 sub-stage 5b): reorder, tag creation, and
 * per-task tag assignment. Same split as every parser above — structural
 * validation only, business rules stay in `TaskService`/`TagService`.
 */

/** `orderIndex` must be a finite, non-negative integer. Negative is
 * rejected as malformed input, not a legal value: `reorderColumn` (see
 * `boardView.ts`) always produces sequential indices starting at 0, so
 * nothing in this codebase ever legitimately sends a negative one. */
export function parseReorderRequest(body: unknown): ParsedRequest<{ orderIndex: number }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const orderIndex = record.orderIndex;
  if (
    typeof orderIndex !== "number" ||
    !Number.isFinite(orderIndex) ||
    !Number.isInteger(orderIndex) ||
    orderIndex < 0
  ) {
    return fail(`"orderIndex" is required and must be a non-negative integer.`);
  }
  return { ok: true, value: { orderIndex } };
}

/** `name` required non-empty; `color`, if present, must be a `#rrggbb` hex
 * string — there's no CHECK constraint on `tags.color` in the migration, so
 * this app-level validation is where a malformed color gets caught. */
export function parseCreateTagRequest(
  body: unknown,
): ParsedRequest<{ name: string; color?: string }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const name = record.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return fail(`"name" is required and must be a non-empty string.`);
  }

  if ("color" in record && record.color !== undefined) {
    const color = record.color;
    if (typeof color !== "string" || !HEX_COLOR_RE.test(color)) {
      return fail(`"color" must be a "#rrggbb" hex string if provided.`);
    }
    return { ok: true, value: { name, color } };
  }
  return { ok: true, value: { name } };
}

/** `tagIds` required, an array of non-negative integers — an empty array is
 * valid and means "no tags" (replace-all semantics, see `TagService.setTaskTags`). */
export function parseSetTaskTagsRequest(body: unknown): ParsedRequest<{ tagIds: number[] }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const tagIds = record.tagIds;
  if (!Array.isArray(tagIds)) {
    return fail(`"tagIds" is required and must be an array of non-negative integers.`);
  }
  for (const id of tagIds) {
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0) {
      return fail(`"tagIds" must contain only non-negative integers.`);
    }
  }
  return { ok: true, value: { tagIds: tagIds as number[] } };
}
