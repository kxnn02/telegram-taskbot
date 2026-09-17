import { DateTime } from "luxon";
import { MANILA_ZONE } from "../domain/overdue.js";

/**
 * Issue #227 (spec #226): which days the standup push skips. Weekends and
 * Philippine holidays (regular and special non-working) are both
 * "not a working day" for this purpose — the annotation on each holiday
 * below is for audit, not behaviour.
 */

type HolidayKind = "regular" | "special";

interface Holiday {
  date: string; // yyyy-MM-dd, Asia/Manila calendar date
  name: string;
  kind: HolidayKind;
}

// 2026 Philippine holidays, per Proclamation No. 1006 s. 2025, verified
// against the proclamation for #228. The EDSA People Power Anniversary
// (2026-02-25) is deliberately absent: that proclamation declares it a
// special *working* day, so the standup still goes out. Eid'l Fitr and
// Eid'l Adha are proclamation-dependent (set annually, close to the date)
// and are deliberately omitted rather than guessed — see the fail-open note
// below for what happens on an unconfirmed date.
const PH_HOLIDAYS_2026: Holiday[] = [
  { date: "2026-01-01", name: "New Year's Day", kind: "regular" },
  { date: "2026-04-02", name: "Maundy Thursday", kind: "regular" },
  { date: "2026-04-03", name: "Good Friday", kind: "regular" },
  { date: "2026-04-09", name: "Araw ng Kagitingan", kind: "regular" },
  { date: "2026-05-01", name: "Labor Day", kind: "regular" },
  { date: "2026-06-12", name: "Independence Day", kind: "regular" },
  { date: "2026-08-31", name: "National Heroes Day", kind: "regular" },
  { date: "2026-11-30", name: "Bonifacio Day", kind: "regular" },
  { date: "2026-12-25", name: "Christmas Day", kind: "regular" },
  { date: "2026-12-30", name: "Rizal Day", kind: "regular" },
  { date: "2026-02-17", name: "Chinese New Year", kind: "special" },
  { date: "2026-04-04", name: "Black Saturday", kind: "special" },
  { date: "2026-08-21", name: "Ninoy Aquino Day", kind: "special" },
  { date: "2026-11-01", name: "All Saints' Day", kind: "special" },
  { date: "2026-11-02", name: "All Souls' Day", kind: "special" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception", kind: "special" },
  { date: "2026-12-24", name: "Christmas Eve", kind: "special" },
  { date: "2026-12-31", name: "New Year's Eve", kind: "special" },
];

const PH_HOLIDAY_DATES = new Set(PH_HOLIDAYS_2026.map((h) => h.date));

/**
 * Decides whether the standup push should skip `now`'s Asia/Manila calendar
 * day, and why. `undefined` means "send" — the caller's default. Converts to
 * Asia/Manila exactly once (reusing the existing `MANILA_ZONE` constant) and
 * reads both the weekday and the ISO date off that single `DateTime`, the
 * same pattern `getWeekBounds`/`dailyDigestPeriodKey` already use.
 *
 * Weekend is checked before holiday, so a holiday that falls on a weekend
 * reports `"weekend"` — the two never both apply, and which one is reported
 * doesn't change the outcome (skip either way).
 *
 * A year the holiday list above does not cover is not a holiday — the
 * standup sends. This list needs a yearly top-up each time a new
 * proclamation lands; the failure mode of forgetting is extra standups,
 * never silence.
 */
export function standupSkipReason(now: Date): "weekend" | "holiday" | undefined {
  const dt = DateTime.fromJSDate(now, { zone: MANILA_ZONE });
  if (dt.weekday === 6 || dt.weekday === 7) return "weekend";
  if (PH_HOLIDAY_DATES.has(dt.toISODate()!)) return "holiday";
  return undefined;
}
