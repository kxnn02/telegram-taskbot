import { DateTime } from "luxon";
import type { Task } from "./types.js";

export const MANILA_ZONE = "Asia/Manila";

const NOT_OVERDUE_STATUSES = new Set(["done"]);

/**
 * A task is overdue when today (Asia/Manila) is past its due date and it
 * isn't `done` (issue #27/#28 — `Cancelled` no longer exists, and `backlog`
 * is deliberately still eligible: a parked task past its due date is still
 * overdue). This is a derived flag, never stored (PRD §4).
 */
export function isOverdue(task: Task, now: Date): boolean {
  if (NOT_OVERDUE_STATUSES.has(task.status)) return false;
  const today = DateTime.fromJSDate(now, { zone: MANILA_ZONE }).startOf("day");
  const due = DateTime.fromISO(task.dueDate, { zone: MANILA_ZONE }).startOf(
    "day",
  );
  return due < today;
}

/** Whole days overdue, for `/backlog`'s "N days overdue" display. Assumes
 * `isOverdue(task, now)` is already true; returns 0 or negative otherwise. */
export function daysOverdue(task: Task, now: Date): number {
  const today = DateTime.fromJSDate(now, { zone: MANILA_ZONE }).startOf("day");
  const due = DateTime.fromISO(task.dueDate, { zone: MANILA_ZONE }).startOf(
    "day",
  );
  return Math.floor(today.diff(due, "days").days);
}
