import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { MANILA_ZONE } from "../domain/overdue.js";

export interface ParsedDueDate {
  /** ISO yyyy-MM-dd, ready to store on a task / pass to the service layer. */
  isoDate: string;
  /** Human-friendly form for the wizard's "That's Friday, Sept 5, 2026" echo. */
  friendly: string;
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

  const parsed = results[0]?.start;
  if (!parsed) return undefined;

  const resolved = parsed.date(); // JS Date instant chrono resolved to
  const dt = DateTime.fromJSDate(resolved, { zone: MANILA_ZONE });
  if (!dt.isValid) return undefined;

  return {
    isoDate: dt.toFormat("yyyy-MM-dd"),
    friendly: dt.toFormat("cccc, LLLL d, yyyy"),
  };
}
