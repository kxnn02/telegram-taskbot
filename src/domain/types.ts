// Core domain types shared by the task-service layer, the bot layer, and
// (later) the dashboard. Kept free of any Telegram- or HTTP-specific types.

export type Role = "Intern" | "HigherUp";

export type TaskStatus =
  | "Assigned"
  | "InProgress"
  | "Submitted"
  | "Approved"
  | "NeedsRevision"
  | "Cancelled";

export interface Note {
  text: string;
  authorUsername: string;
  createdAt: string; // ISO timestamp
}

export interface Task {
  id: number; // sequential, scoped per cohort
  cohortId: string;
  title: string;
  description: string;
  assigneeUsername: string; // must resolve to an Intern in the roster
  assignedByUsername: string; // higher-up who created it
  dueDate: string; // ISO date (yyyy-MM-dd), Asia/Manila-resolved
  status: TaskStatus;
  notes: Note[];
  blocked: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Identity of the caller making a service-layer request. */
export interface Caller {
  username: string;
  role: Role;
  cohortId: string;
}

/** A roster entry: who someone is, independent of whether they've /start'd yet. */
export interface RosterEntry {
  username: string;
  role: Role;
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
