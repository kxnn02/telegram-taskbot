import { DateTime } from "luxon";
import type { Task } from "../domain/types.js";
import { MANILA_ZONE } from "../domain/overdue.js";

/**
 * Pure query: tasks Approved within the trailing 7 days, for the weekly
 * Monday higher-up digest (PRD §8 — "what was Approved in the past week").
 */
export function approvedInPastWeek<T extends Task>(tasks: T[], now: Date): T[] {
  const cutoff = DateTime.fromJSDate(now, { zone: MANILA_ZONE }).minus({
    days: 7,
  });
  return tasks.filter(
    (task) =>
      task.status === "Approved" &&
      DateTime.fromISO(task.updatedAt, { zone: MANILA_ZONE }) >= cutoff,
  );
}
