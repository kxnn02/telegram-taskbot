/**
 * Storage port for scheduler bookkeeping on which tasks have already fired
 * their one-time overdue-crossing notification (PRD §8: "fires exactly once
 * per task, not repeatedly"). Deliberately separate from `TaskStorePort" —
 * this is scheduler bookkeeping, not a task business-rule field, and keeps
 * `TaskService` free of any notion of "has this been notified."
 */
export interface OverdueNotificationStorePort {
  hasNotified(cohortId: string, taskId: number): Promise<boolean>;
  markNotified(cohortId: string, taskId: number): Promise<void>;
}
