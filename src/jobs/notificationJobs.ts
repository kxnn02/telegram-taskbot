import type { AlertThrottleStorePort } from "../storage/alertThrottleStorePort.js";
import {
  runDailyDigest,
  runDueSoonReminderCheck,
  runOverdueCrossingCheck,
  runWeeklyDigest,
  type SchedulerDeps,
} from "../notifications/scheduler.js";
import { DigestBuilder } from "../notifications/digestBuilder.js";
import { dailyDigestPeriodKey, weeklyDigestPeriodKey } from "./digestPeriodKey.js";

/**
 * Core job logic behind the four `/api/jobs/*` notification-job endpoints
 * (ADR-0007): thin wrappers around the already-tested `run*` functions in
 * `src/notifications/scheduler.ts` (unchanged — only `startScheduler`'s
 * node-cron wiring goes away in this phase), scoped to exactly one cohort
 * per call.
 *
 * **Single-cohort, not all-roster** (a deliberate departure from
 * `startScheduler`'s old `for (const cohortId of cohortIds(roster))`
 * loop): each deployed instance is bound to one `ACTIVE_COHORT_ID`
 * (`api/telegram/webhook.ts`'s doc comment, CONTEXT.md's cohort-binding
 * note) — the real cohort and the dry-run cohort are separate Vercel
 * deployments/branches, each with its own env vars, never one instance
 * serving both. A jobs endpoint looping every cohort in the roster would
 * mean the dry-run deployment's cron could reach into the real cohort's
 * data (or vice versa) purely because both cohorts' rows live in the one
 * shared Supabase project — exactly the risk ADR-0011's dry-run strategy
 * calls out as needing "airtight" cohort-scoping. So each job's HTTP
 * endpoint calls these functions with its own deployment's
 * `ACTIVE_COHORT_ID` only.
 */
export interface NotificationJobDeps extends SchedulerDeps {
  throttle: AlertThrottleStorePort;
}

export async function runOverdueCrossingJob(
  deps: NotificationJobDeps,
  cohortId: string,
  now: Date = new Date(),
): Promise<void> {
  await runOverdueCrossingCheck(deps, cohortId, now);
}

export async function runDueSoonReminderJob(
  deps: NotificationJobDeps,
  cohortId: string,
  now: Date = new Date(),
): Promise<void> {
  await runDueSoonReminderCheck(deps, cohortId, now);
}

/**
 * Daily digest job, with idempotency (ADR-0007): claims
 * `digest:{cohortId}:daily:{periodKey}` in `alert_throttle` before sending
 * anything. If the claim fails — a `pg_net` retry landing on a call that
 * actually already succeeded — this is a no-op returning success, not an
 * error, since the retry's request was already fulfilled by the earlier
 * call.
 */
export async function runDailyDigestJob(
  deps: NotificationJobDeps,
  cohortId: string,
  now: Date = new Date(),
): Promise<void> {
  const key = `digest:${cohortId}:daily:${dailyDigestPeriodKey(now)}`;
  const claimed = await deps.throttle.claim(key);
  if (!claimed) return;
  const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
  await runDailyDigest(deps, digestBuilder, cohortId);
}

/** Weekly digest job — same idempotency shape as `runDailyDigestJob`, keyed
 * by the Asia/Manila Monday that starts the current week. */
export async function runWeeklyDigestJob(
  deps: NotificationJobDeps,
  cohortId: string,
  now: Date = new Date(),
): Promise<void> {
  const key = `digest:${cohortId}:weekly:${weeklyDigestPeriodKey(now)}`;
  const claimed = await deps.throttle.claim(key);
  if (!claimed) return;
  const digestBuilder = new DigestBuilder({ service: deps.service, roster: deps.roster });
  await runWeeklyDigest(deps, digestBuilder, cohortId, now);
}
