import type { CohortStorePort } from "./cohortStorePort.js";

/** In-memory `CohortStorePort` implementation: used by fast tests in place
 * of the real Supabase-backed store. */
export class InMemoryCohortStore implements CohortStorePort {
  private readonly groupChatIds: Map<string, string>;
  private readonly standupEnabled = new Map<string, boolean>();

  constructor(seed: Record<string, string> = {}) {
    this.groupChatIds = new Map(Object.entries(seed));
  }

  async getGroupChatId(cohortId: string): Promise<string | undefined> {
    return this.groupChatIds.get(cohortId);
  }

  async setGroupChatId(cohortId: string, groupChatId: string): Promise<void> {
    if (groupChatId === "") {
      this.groupChatIds.delete(cohortId);
      return;
    }
    this.groupChatIds.set(cohortId, groupChatId);
  }

  async isStandupEnabled(cohortId: string): Promise<boolean> {
    return this.standupEnabled.get(cohortId) ?? false;
  }

  async setStandupEnabled(cohortId: string, enabled: boolean): Promise<void> {
    this.standupEnabled.set(cohortId, enabled);
  }
}
