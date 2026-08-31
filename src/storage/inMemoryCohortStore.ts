import type { CohortStorePort } from "./cohortStorePort.js";

/** In-memory `CohortStorePort` implementation: used by fast tests in place
 * of the real Supabase-backed store. */
export class InMemoryCohortStore implements CohortStorePort {
  private readonly groupChatIds: Map<string, string>;

  constructor(seed: Record<string, string> = {}) {
    this.groupChatIds = new Map(Object.entries(seed));
  }

  async getGroupChatId(cohortId: string): Promise<string | undefined> {
    return this.groupChatIds.get(cohortId);
  }
}
