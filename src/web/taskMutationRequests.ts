import type { AssignTaskInput, EditTaskInput } from "../service/taskService.js";

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

export function parseEditTaskRequest(body: unknown): ParsedRequest<EditTaskInput> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const patch: EditTaskInput = {};
  for (const field of EDIT_TASK_FIELDS) {
    if (!(field in record)) continue;
    const value = record[field];
    if (typeof value !== "string") {
      return fail(`"${field}" must be a string if provided.`);
    }
    patch[field] = value;
  }
  return { ok: true, value: patch };
}
