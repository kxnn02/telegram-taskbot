import { DateTime } from "luxon";
import type { Task } from "../domain/types.js";
import { MANILA_ZONE } from "../domain/overdue.js";

/** Statuses for which a "due tomorrow" reminder is still meaningful (issue
 * #27/#28's status retarget): `todo`/`in_progress` are still being worked;
 * `in_review`/`done`/`backlog` have moved past "still to do", and `blocked`
 * has nothing actionable to remind about until it's unblocked. This is a
 * one-to-one mapping of the old Assigned/InProgress/NeedsRevision set, with
 * one deliberate behavior change: a task blocked while Assigned/InProgress
 * no longer gets reminded (it didn't have its own status before, so it
 * rode along with whichever of those it was in — now that `blocked` is its
 * own status, it's excluded like the rest of the non-active statuses). */
const REMINDABLE_STATUSES = new Set(["todo", "in_progress"]);

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
