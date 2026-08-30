import type { DatabaseSync } from "./schema.js";

/**
 * Tracks which tasks have already fired their one-time overdue-crossing
 * notification (PRD §8: "fires exactly once per task, not repeatedly").
 * Deliberately separate from the tasks table itself — this is scheduler
 * bookkeeping, not a task business-rule field, and keeps TaskService free of
 * any notion of "has this been notified."
 */
export class OverdueNotificationRepository {
  constructor(private readonly db: DatabaseSync) {}

  hasNotified(cohortId: string, taskId: number): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM overdue_notifications WHERE cohort_id = ? AND task_id = ?",
      )
      .get(cohortId, taskId);
    return row !== undefined;
  }

  markNotified(cohortId: string, taskId: number): void {
    this.db
      .prepare(
        `INSERT INTO overdue_notifications (cohort_id, task_id, notified_at)
         VALUES (?, ?, ?)
         ON CONFLICT(cohort_id, task_id) DO NOTHING`,
      )
      .run(cohortId, taskId, new Date().toISOString());
  }
}
