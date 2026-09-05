// Core domain types shared by the task-service layer, the bot layer, and
// (later) the dashboard. Kept free of any Telegram- or HTTP-specific types.

/**
 * The six free-set statuses (ADR-0009 / issue #27's normative status
 * table), replacing the old gated Assigned/InProgress/Submitted/Approved/
 * NeedsRevision/Cancelled lifecycle. Any roster member may set any of these
 * on any task in their own cohort — there is no legal-transition check.
 */
export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done";

export interface Note {
  text: string;
  authorUsername: string;
  createdAt: string; // ISO timestamp
}

export interface Task {
  id: number; // sequential, scoped per cohort
  cohortId: string;
  title: string;
  description?: string; // optional (issue #27/#28) — fillable later via /edit or /note
  assigneeUsername: string; // any roster member (issue #27)
  assignedByUsername: string; // whoever created it
  dueDate: string; // ISO date (yyyy-MM-dd), Asia/Manila-resolved
  status: TaskStatus;
  notes: Note[];
  /** The status a task was in immediately before its most recent
   * transition into `blocked`, so `/unblock` has a defined restore target.
   * Written only on entry to `blocked`; cleared on every exit from
   * `blocked` (whether via `clearBlocked` or a plain `setStatus`); never
   * overwritten by re-blocking an already-blocked task (issue #27's
   * previous_status lifecycle rules). `null` when the task isn't currently
   * blocked, or was never blocked. */
  previousStatus: TaskStatus | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Identity of the caller making a service-layer request. There is no
 * access-control tier (ADR-0013 supersedes ADR-0002/ADR-0010): any roster
 * member may act on any task in their own cohort — cohort scoping is the
 * only boundary that survives. */
export interface Caller {
  username: string;
  cohortId: string;
}

/** A roster entry: who someone is, independent of whether they've /start'd
 * yet. Populated by auto-registration (ADR-0013) rather than by an admin. */
export interface RosterEntry {
  username: string;
  cohortId: string;
}

/** Discriminated-union result type used by every service-layer mutation. */
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: string): ServiceResult<T> {
  return { ok: false, error };
}
