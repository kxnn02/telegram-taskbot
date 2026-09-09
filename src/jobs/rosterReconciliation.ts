import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { CohortStorePort } from "../storage/cohortStorePort.js";
import type { AlertThrottleStorePort } from "../storage/alertThrottleStorePort.js";
import type { Roster } from "../domain/roster.js";
import type { NotifierBot } from "../notifications/scheduler.js";
import { sendDM } from "../notifications/scheduler.js";
import { checkGroupMembership, type MembershipApi } from "../bot/groupMembership.js";

/**
 * How long a `(cohortId, username)` "left the group" flag stays throttled
 * before it can be re-reported (ticket R5/#89 — "do not repeat the same
 * warning every day"). The job runs daily, so a 1-day window would DM every
 * other member on every single run for as long as the person stays gone. 7 days
 * matches the daily cadence the ticket asks for ("reported roughly weekly,
 * not daily") — a standing absence is still surfaced regularly enough that
 * it can't be forgotten, but stops being noise after the first DM.
 */
export const ROSTER_RECONCILIATION_THROTTLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface RosterReconciliationDeps {
  bot: NotifierBot;
  /** Narrow grammy api slice for `checkGroupMembership`'s `getChatMember`
   * calls — see `src/bot/groupMembership.ts`. */
  api: MembershipApi;
  registrations: RegistrationStorePort;
  roster: Roster;
  cohorts: CohortStorePort;
  throttle: AlertThrottleStorePort;
}

/**
 * Daily roster-reconciliation job (ticket R5/#90): walks one cohort's
 * roster, flags members who have left the cohort's Telegram group, and DMs
 * every other member of that cohort about them (ADR-0013 — there is no
 * more privileged tier to single out; every roster member gets the same
 * report). Never removes anyone — see
 * the ticket/CONTEXT.md for why auto-removal is deliberately out of scope
 * (composes badly with #89's "refuse removal while open tasks exist" rule,
 * and trusts one Telegram API answer more than it should).
 *
 * A roster member with no registration (`findTelegramId` returns
 * `undefined`, i.e. they never ran `/start`) is skipped, not flagged —
 * `getChatMember` needs a Telegram user id and the roster is keyed by
 * username, so an unregistered member simply cannot be checked, and they
 * have no bot access to lose anyway (every data-bearing command goes
 * through `withCaller`, which requires a registration).
 *
 * If `checkGroupMembership` reports `unavailable` for any member (no group
 * configured for this cohort, or the Telegram API call failed), this
 * **aborts the whole cohort's reconciliation by throwing** rather than
 * treating the rest of the roster as absent — a `NULL group_chat_id` or one
 * flaky API call must never be read as "everyone left." The thrown error is
 * meant to be caught by the caller's job-endpoint envelope
 * (`src/jobs/jobEndpoint.ts`) and reported via `notifyJobFailure`, which
 * already throttles repeat reports of the same problem — reusing that path
 * is exactly how this gets reported "once as a job problem" instead of on
 * every run.
 *
 * Unlike the daily/weekly digests (#62's "Do not do this", ADR-0007), this
 * job never posts to the group chat — it only DMs individuals — so a
 * `pg_net` retry double-sending a DM is strictly better than a silently
 * dropped departure warning (issue #163). That's why it's safe here, and
 * not for the digests, to only spend a member's throttle claim once a
 * warning about them was actually delivered.
 */
export async function runRosterReconciliationJob(
  deps: RosterReconciliationDeps,
  cohortId: string,
  now: Date = new Date(),
): Promise<void> {
  const entries = deps.roster.all().filter((entry) => entry.cohortId === cohortId);
  const groupChatId = await deps.cohorts.getGroupChatId(cohortId);

  const absentUsernames: string[] = [];
  for (const entry of entries) {
    const telegramId = await deps.registrations.findTelegramId(entry.username);
    if (!telegramId) continue; // unregistered — can't be checked, not flagged.

    const check = await checkGroupMembership(deps.api, groupChatId, telegramId);
    if (check.kind === "unavailable") {
      throw new Error(
        `roster reconciliation for cohort "${cohortId}" aborted: membership check unavailable (${check.reason})`,
      );
    }
    if (check.kind === "absent") {
      absentUsernames.push(entry.username);
    }
  }

  if (absentUsernames.length === 0) return;

  const remaining = entries.filter((entry) => !absentUsernames.includes(entry.username));

  // `AlertThrottleStorePort` has no peek-only read — `claimWithWindow` is
  // an atomic check-and-set, so calling it to decide "should this be
  // reported today" always spends the claim, even if nobody ends up
  // reachable (issue #163). Read-only registration lookups don't have that
  // problem, so check reachability first: if nobody in `remaining` has
  // ever registered, the warning cannot possibly be delivered and the
  // throttle store is never touched, so the next run retries with a clean
  // slate instead of finding the claim already spent.
  let anyoneReachable = false;
  for (const member of remaining) {
    if (await deps.registrations.findTelegramId(member.username)) {
      anyoneReachable = true;
      break;
    }
  }
  if (!anyoneReachable) {
    console.error(
      `runRosterReconciliationJob: cohort "${cohortId}" has no reachable remaining member to warn about: ${absentUsernames.join(", ")}`,
    );
    return;
  }

  const toReport: string[] = [];
  for (const username of absentUsernames) {
    const key = `roster-reconciliation:${cohortId}:${username}`;
    const claimed = await deps.throttle.claimWithWindow(key, ROSTER_RECONCILIATION_THROTTLE_WINDOW_MS);
    if (claimed) toReport.push(username);
  }
  if (toReport.length === 0) return;

  const text = `Roster reconciliation: the following member(s) appear to have left the cohort group and no longer show as present: ${toReport.join(", ")}. They still hold roster access — review and remove them manually if they've actually left.`;
  for (const member of remaining) {
    await sendDM(deps.bot, deps.registrations, member.username, text);
  }
}
