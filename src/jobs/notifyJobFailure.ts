import type { AlertThrottleStorePort } from "../storage/alertThrottleStorePort.js";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import { sendDM, type NotifierBot } from "../notifications/scheduler.js";

/** How long to stay quiet about the same job/cohort failing again before
 * DMing the maintainer a second time (ADR-0007's "once per problem, not once
 * per recurrence"). Chosen as 24 hours: a job failing on every run within a
 * day is treated as one ongoing problem (no point re-alerting on every
 * hourly overdue-crossing retry of the same root cause); a failure the next
 * day gets its own alert even with no manual intervention in between, since
 * `alert_throttle` rows are never otherwise cleaned up and we'd rather risk
 * one redundant DM a day than go silent forever on a recurring problem. The
 * throttle key deliberately has no timestamp baked in
 * (`error:{jobName}:{cohortId}`) — the windowing lives in `last_sent_at`,
 * not the key, so the same key naturally becomes reclaimable again once the
 * window elapses instead of accumulating a new row per day. */
export const ERROR_THROTTLE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface NotifyJobFailureDeps {
  bot: NotifierBot;
  registrations: RegistrationStorePort;
  throttle: AlertThrottleStorePort;
  /** Roster username (no leading @) of the maintainer to DM on job failure.
   * Must have run /start against this same deployment at some point, same
   * requirement as any other DM (`sendDM`'s doc comment). */
  maintainerUsername: string;
}

/**
 * Self-DM-on-error (ADR-0007): DMs the maintainer when a job endpoint's core
 * logic throws, throttled via the shared `alert_throttle` claim pattern so
 * a job stuck failing on every run doesn't spam the maintainer's DMs. Never
 * throws itself — a failure to *report* a failure must not mask the
 * original error from the caller (the job endpoint still returns 500).
 */
export async function notifyJobFailure(
  deps: NotifyJobFailureDeps,
  jobName: string,
  cohortId: string,
  error: unknown,
): Promise<void> {
  const key = `error:${jobName}:${cohortId}`;
  const claimed = await deps.throttle.claimWithWindow(key, ERROR_THROTTLE_WINDOW_MS);
  if (!claimed) return;

  const message = error instanceof Error ? error.message : String(error);
  const text = `Job "${jobName}" failed for cohort "${cohortId}": ${message}`;
  await sendDM(deps.bot, deps.registrations, deps.maintainerUsername, text);
}
