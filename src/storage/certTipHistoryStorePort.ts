/**
 * Storage port for per-cohort "last cert tip shown via /standup" history.
 * Backs `selectRandomCertTip`'s never-repeat-twice-in-a-row behavior for the
 * on-demand `/standup` command only — the scheduled daily push job and
 * dashboard Preview/Test deliberately keep using the existing date-seeded
 * `selectCertTipForDate` and never touch this.
 */
export interface CertTipHistoryStorePort {
  /** The id of the last cert tip shown to this cohort via /standup, or null
   * if none has been shown yet. */
  getLastTipId(cohortId: string): Promise<number | null>;
  /** Records the id of the cert tip just shown to this cohort via /standup. */
  setLastTipId(cohortId: string, tipId: number): Promise<void>;
}
