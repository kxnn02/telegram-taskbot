import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { MANILA_ZONE } from "../domain/overdue.js";

export interface DueDateResult {
  /** ISO yyyy-MM-dd, ready to store on a task / pass to the service layer. */
  isoDate: string;
  /** Human-friendly form for the wizard's "That's Friday, Sept 5, 2026" echo. */
  friendly: string;
}

export interface ParsedDueDate extends DueDateResult {
  /** Index into the input string where chrono's match starts — lets a
   * caller (e.g. /addtask's title/date split, issue #30) know which part
   * of the string was the date, without a second regex pass over it. */
  index: number;
  /** The exact substring chrono matched as the date phrase. */
  text: string;
}

/**
 * Parses a natural-language due-date phrase ("next Friday", "in 3 days",
 * "Sept 5") relative to Asia/Manila "now", per PRD §5/§8/§12. Returns
 * `undefined` when chrono can't find a date at all — the caller (bot layer)
 * is responsible for the confirm-before-save echo step, not this function.
 */
export function parseDueDate(
  text: string,
  referenceDate: Date = new Date(),
): ParsedDueDate | undefined {
  const results = chrono.parse(
    text,
    { instant: referenceDate, timezone: MANILA_ZONE },
    { forwardDate: true },
  );
  if (results.length === 0) return undefined;

  const result = results[0]!;
  const parsed = result.start;
  if (!parsed) return undefined;

  const resolved = parsed.date(); // JS Date instant chrono resolved to
  const dt = DateTime.fromJSDate(resolved, { zone: MANILA_ZONE });
  if (!dt.isValid) return undefined;

  return {
    isoDate: dt.toFormat("yyyy-MM-dd"),
    friendly: dt.toFormat("cccc, LLLL d, yyyy"),
    index: result.index,
    text: result.text,
  };
}

const FRIDAY_ISO_WEEKDAY = 5;

/** Default due date for a bare `/addtask <title>` (no "by" clause): the
 * coming Friday, Asia/Manila. When `referenceDate` already falls on a
 * Friday there, "coming" resolves to that same day (issue #27 — this
 * cohort has no onsite-day configuration to default to instead). */
export function comingFriday(referenceDate: Date = new Date()): DueDateResult {
  const dt = DateTime.fromJSDate(referenceDate, { zone: MANILA_ZONE });
  const daysUntilFriday = (FRIDAY_ISO_WEEKDAY - dt.weekday + 7) % 7;
  const due = dt.plus({ days: daysUntilFriday });
  return {
    isoDate: due.toFormat("yyyy-MM-dd"),
    friendly: due.toFormat("cccc, LLLL d, yyyy"),
  };
}

/** Luxon ISO weekday numbers (1 = Monday .. 7 = Sunday) for Tuesday/Thursday. */
const ONSITE_WEEKDAYS = new Set([2, 4]);

/**
 * DevieBot's `defaultDueDate()` (`app/api/telegram/webhook/route.ts:12-14`,
 * delegating to `lib/date.ts:69-76`'s `getNextOnsiteDay` @ `632a22c`): the
 * nearest upcoming Tuesday or Thursday, Asia/Manila-resolved. Always
 * strictly after `referenceDate` — even a `referenceDate` that already
 * falls on Tuesday or Thursday rolls forward to the *next* one, never the
 * same day (issue #104's bulk-paste default, kept deliberately separate
 * from `comingFriday`, which is issue #27's default for the single-task
 * `/addtask` grammar and predates the carbon-copy direction).
 */
export function getNextOnsiteDay(referenceDate: Date = new Date()): DueDateResult {
  let dt = DateTime.fromJSDate(referenceDate, { zone: MANILA_ZONE }).plus({ days: 1 });
  while (!ONSITE_WEEKDAYS.has(dt.weekday)) {
    dt = dt.plus({ days: 1 });
  }
  return {
    isoDate: dt.toFormat("yyyy-MM-dd"),
    friendly: dt.toFormat("cccc, LLLL d, yyyy"),
  };
}
