import type { CertTipHistoryStorePort } from "./certTipHistoryStorePort.js";

/** In-memory `CertTipHistoryStorePort` for fast tests: a plain `Map` keyed
 * by cohort id, holding the last cert tip id shown to that cohort. */
export class InMemoryCertTipHistoryStore implements CertTipHistoryStorePort {
  private readonly lastTipIdByCohort = new Map<string, number>();

  async getLastTipId(cohortId: string): Promise<number | null> {
    return this.lastTipIdByCohort.get(cohortId) ?? null;
  }

  async setLastTipId(cohortId: string, tipId: number): Promise<void> {
    this.lastTipIdByCohort.set(cohortId, tipId);
  }
}
