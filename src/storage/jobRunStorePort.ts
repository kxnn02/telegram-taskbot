import type { JobRunStatus } from "../domain/types.js";

/**
 * Storage port for the `job_runs` table (issue #43): a durable record of
 * every job-endpoint invocation's outcome, independent of Vercel's own
 * runtime-log retention (Hobby: ~1h) and Cron Jobs dashboard, which is why
 * `keep-alive` and `weekly-backup` sitting misconfigured and unfired for
 * months went unnoticed in the first place.
 */
export interface JobRunStorePort {
  /** Records one job invocation's outcome. Never called for a deliberate
   * 401/405 (`handleJobEndpoint` only records when `work()` actually ran) —
   * `detail` carries the thrown error's message on `"error"`, `null` on
   * `"success"`. */
  record(jobName: string, status: JobRunStatus, detail: string | null): Promise<void>;
}
