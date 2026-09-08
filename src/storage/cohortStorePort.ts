/**
 * Storage port for the `cohorts` table (ADR-0006): gives each cohort
 * (including the dry-run one) its own Telegram group chat, replacing the
 * single global `GROUP_CHAT_ID` env var that couldn't distinguish the real
 * cohort's group from the dry-run's "dump" group (ADR-0004's one real gap).
 */
export interface CohortStorePort {
  /** The Telegram chat id of a cohort's group chat, for the daily standup
   * summary — undefined if the cohort has none configured yet (matches
   * today's behavior of skipping the group-chat post when unset). */
  getGroupChatId(cohortId: string): Promise<string | undefined>;

  /** Sets (or clears, via an empty string) a cohort's group chat id — the
   * dashboard settings page's one editable field (issue #105 sub-stage 5c),
   * the closest analog this repo has to Devie's `telegram_config.chat_id`.
   * Unlike that field, this is never a secret and was already a plain
   * column on `cohorts` before this stage (ADR-0006) — this stage only adds
   * a setter and a UI to reach it, not a new concept. */
  setGroupChatId(cohortId: string, groupChatId: string): Promise<void>;

  /** Whether the daily standup push (`api/jobs/standup-push.ts`, scheduled
   * by pg_cron per issue #131) should post into this cohort's group chat.
   * A cohort with no row at all reads as `false`, never a throw — the same
   * "unset means off" contract `getGroupChatId` already has. */
  isStandupEnabled(cohortId: string): Promise<boolean>;

  /** Sets the standup on/off switch — the dashboard settings page's
   * Auto-standup toggle (issue #131 Build 4). */
  setStandupEnabled(cohortId: string, enabled: boolean): Promise<void>;
}
