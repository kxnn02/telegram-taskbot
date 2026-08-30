import { DateTime } from "luxon";
import type { Task } from "../domain/types.js";
import { MANILA_ZONE } from "../domain/overdue.js";

/** Statuses for which a "due tomorrow" reminder is still meaningful — once a
 * task is Submitted/Approved/Cancelled there's nothing left to remind the
 * intern to do. */
const REMINDABLE_STATUSES = new Set(["Assigned", "InProgress", "NeedsRevision"]);

/**
 * Pure query: tasks due exactly tomorrow, Asia/Manila-resolved (PRD §8 —
 * due-date reminder "~1 day before due date"). Naturally fires once per task
 * as long as the scheduler runs this once a day; no persisted "already
 * reminded" state is needed the way overdue-crossing needs one, since a
 * given date only ever equals "tomorrow" on a single calendar day.
 */
export function findDueTomorrow(tasks: Task[], now: Date): Task[] {
  const tomorrow = DateTime.fromJSDate(now, { zone: MANILA_ZONE })
    .plus({ days: 1 })
    .toISODate();
  return tasks.filter(
    (task) => task.dueDate === tomorrow && REMINDABLE_STATUSES.has(task.status),
  );
}
