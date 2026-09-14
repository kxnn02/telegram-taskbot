import { DateTime } from "luxon";
import { MANILA_ZONE } from "../domain/overdue.js";

export type DueDateForm = "long" | "short";

/**
 * Issue #203 (spec #201, "A single due-date renderer is the root of the
 * change") — the only place in the codebase permitted to turn a due date
 * into display text. Pure: takes the due date, a `now`, whether the task is
 * overdue, and a form. Reads the cohort timezone from the existing
 * `MANILA_ZONE` constant and never reads the clock itself, matching this
 * repo's existing pure-view-logic convention (`src/date/weekBounds.ts`,
 * `src/domain/overdue.ts`).
 *
 * It deliberately does not re-derive whether the task is overdue — `overdue`
 * is supplied by the caller (the service layer), exactly as `isOverdue`
 * already computes it today. Day arithmetic is otherwise at day granularity
 * in `MANILA_ZONE`, matching that same derivation.
 *
 * Long form is for messages about a single task; short form is for anything
 * listing several (spec #201's output table, ticket #203's acceptance
 * criteria).
 */
export function renderDueDate(
  dueDate: string | null | undefined,
  now: Date,
  overdue: boolean,
  form: DueDateForm,
): string {
  if (!dueDate) return "";

  const today = DateTime.fromJSDate(now, { zone: MANILA_ZONE }).startOf("day");
  const due = DateTime.fromISO(dueDate, { zone: MANILA_ZONE }).startOf("day");
  const diffDays = due.diff(today, "days").days;

  if (overdue) {
    const daysAgo = Math.round(-diffDays);
    return daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
  }
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";

  const sameYear = due.year === today.year;
  if (form === "long") {
    return due.toFormat(sameYear ? "EEEE, MMMM d" : "EEEE, MMMM d, yyyy");
  }
  return due.toFormat(sameYear ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}
