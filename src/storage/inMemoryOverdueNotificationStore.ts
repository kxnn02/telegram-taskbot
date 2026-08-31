import type { OverdueNotificationStorePort } from "./overdueNotificationStorePort.js";

function key(cohortId: string, taskId: number): string {
  return `${cohortId}:${taskId}`;
}

/** In-memory `OverdueNotificationStorePort` implementation: used by tests
 * (and, for now, by production wiring as a placeholder — see
 * `SupabaseOverdueNotificationStore`). */
export class InMemoryOverdueNotificationStore implements OverdueNotificationStorePort {
  private readonly notified = new Set<string>();

  async hasNotified(cohortId: string, taskId: number): Promise<boolean> {
    return this.notified.has(key(cohortId, taskId));
  }

  async markNotified(cohortId: string, taskId: number): Promise<void> {
    this.notified.add(key(cohortId, taskId));
  }
}
