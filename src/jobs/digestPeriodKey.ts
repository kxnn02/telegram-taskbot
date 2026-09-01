import { DateTime } from "luxon";
import { MANILA_ZONE } from "../domain/overdue.js";

/**
 * Digest idempotency period keys (ADR-0007): the daily/weekly digest jobs
 * claim `digest:{cohortId}:{daily|weekly}:{periodKey}` in `alert_throttle`
 * before sending anything. Resolved in Asia/Manila (PRD §8/§12), same as
 * every other scheduled-notification time calculation in this codebase
 * (`findDueTomorrow`, `approvedInPastWeek`) — a `pg_net` retry landing a few
 * minutes either side of midnight UTC must still land on the same calendar
 * day/week a human in Manila would call "today"/"this week".
 */

/** The Asia/Manila calendar date (`YYYY-MM-DD`) `now` falls on — the daily
 * digest's period key. */
export function dailyDigestPeriodKey(now: Date): string {
  return DateTime.fromJSDate(now, { zone: MANILA_ZONE }).toISODate()!;
}

/** The Asia/Manila Monday (`YYYY-MM-DD`) that starts the week `now` falls
 * in — the weekly digest's period key, so every day in the same
 * Monday-to-Sunday week maps to the same key. */
export function weeklyDigestPeriodKey(now: Date): string {
  return DateTime.fromJSDate(now, { zone: MANILA_ZONE })
    .startOf("week") // luxon's default week starts Monday.
    .toISODate()!;
}
