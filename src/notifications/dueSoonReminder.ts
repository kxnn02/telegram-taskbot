import { DateTime } from "luxon";
import type { Task } from "../domain/types.js";
import { MANILA_ZONE } from "../domain/overdue.js";

/**
 * Pure query: tasks due exactly tomorrow, Asia/Manila-resolved (PRD §8 —
 * due-date reminder "~1 day before due date"). Naturally fires once per task
 * as long as the scheduler runs this once a day; no persisted "already
 * reminded" state is needed the way overdue-crossing needs one, since a
 * given date only ever equals "tomorrow" on a single calendar day.
 *
 * A due-tomorrow reminder is meaningful for every status except `done`
 * (issue #27/#29) — free-set statuses have no terminal-but-not-done state
 * left to carve out an allowlist for, so this is a blocklist of one rather
 * than the old `REMINDABLE_STATUSES` allowlist. Eligibility never depends
 * on the assignee's role — a task assigned to a `HigherUp` reminds exactly
 * like one assigned to an `Intern`.
 */
export function findDueTomorrow(tasks: Task[], now: Date): Task[] {
  const tomorrow = DateTime.fromJSDate(now, { zone: MANILA_ZONE })
    .plus({ days: 1 })
    .toISODate();
  return tasks.filter((task) => task.dueDate === tomorrow && task.status !== "done");
}
