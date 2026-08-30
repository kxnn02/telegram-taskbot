import type { Task } from "../domain/types.js";
import { isOverdue } from "../domain/overdue.js";

/**
 * Pure query: which tasks just crossed into "overdue" and haven't already
 * had their one-time overdue-crossing notification sent (PRD §8 — "fires
 * exactly once per task, not repeatedly"). The scheduler is responsible for
 * calling `markNotified` (via OverdueNotificationRepository) for every task
 * this returns, right after sending the notification.
 */
export function findNewOverdueCrossings(
  tasks: Task[],
  now: Date,
  hasNotified: (cohortId: string, taskId: number) => boolean,
): Task[] {
  return tasks.filter(
    (task) => isOverdue(task, now) && !hasNotified(task.cohortId, task.id),
  );
}
