import { DateTime } from "luxon";
import { MANILA_ZONE } from "../domain/overdue.js";

export interface WeekBounds {
  thisWeekStart: string;
  thisWeekEnd: string;
  lastWeekStart: string;
  lastWeekEnd: string;
}

/**
 * Issue #107, deviation #2 in "What to build": Devie's `getWeekBounds`
 * (`lib/standup.ts:64`) — Sun-Sat weeks, Asia/Manila-resolved. Built over
 * this repo's Luxon-based `src/date/` layer (`parseDueDate.ts`,
 * `getNextOnsiteDay`) rather than porting their hand-rolled `Intl` juggling,
 * per the ticket's own instruction — the same call issue #102 made about
 * Devie's date helpers.
 *
 * All four ISO dates are yyyy-MM-dd, ready to feed `formatWeekLabel` or a
 * date-range filter over `TaskWithFlags.updatedAt`/`dueDate`.
 */
export function getWeekBounds(todayISO: string): WeekBounds {
  const today = DateTime.fromISO(todayISO, { zone: MANILA_ZONE }).startOf("day");
  // Luxon's `.weekday` is 1 (Monday) .. 7 (Sunday). A Sunday-start week needs
  // "days since the most recent Sunday": Sunday itself -> 0, Monday -> 1, ...
  // Saturday -> 6 — exactly `weekday % 7`.
  const daysSinceSunday = today.weekday % 7;
  const thisWeekStart = today.minus({ days: daysSinceSunday });
  const thisWeekEnd = thisWeekStart.plus({ days: 6 });
  const lastWeekStart = thisWeekStart.minus({ days: 7 });
  const lastWeekEnd = thisWeekStart.minus({ days: 1 });

  const iso = (dt: DateTime) => dt.toFormat("yyyy-MM-dd");
  return {
    thisWeekStart: iso(thisWeekStart),
    thisWeekEnd: iso(thisWeekEnd),
    lastWeekStart: iso(lastWeekStart),
    lastWeekEnd: iso(lastWeekEnd),
  };
}

/** Devie's `formatWeekLabel(a, b)` (`lib/standup.ts:86`) — `"Apr 27 – May 3"`,
 * with an en dash (U+2013), not a hyphen. */
export function formatWeekLabel(startISO: string, endISO: string): string {
  const start = DateTime.fromISO(startISO, { zone: MANILA_ZONE });
  const end = DateTime.fromISO(endISO, { zone: MANILA_ZONE });
  return `${start.toFormat("LLL d")} – ${end.toFormat("LLL d")}`;
}
