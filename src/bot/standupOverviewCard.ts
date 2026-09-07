import { DateTime } from "luxon";
import type { StandupReport } from "./standup.js";
import { formatCohortName, formatReportDate } from "./standup.js";
import { greeting, renderByMember } from "./standupCard.js";
import { esc } from "./html.js";
import { STATUS_EMOJI, statusLabel } from "./format.js";
import { getWeekBounds, formatWeekLabel } from "../date/weekBounds.js";
import { MANILA_ZONE } from "../domain/overdue.js";
import type { TaskWithFlags } from "../service/taskService.js";

/**
 * Issue #107: assembles the HTML card the authenticated push endpoint sends
 * into the cohort group — Devie's `buildStandupPage("overview", ...)`
 * (`lib/standup.ts`), carbon-copied for layout/wording/emoji/HTML tags
 * (rules 1-3), with the deviations this ticket calls for: the cohort name
 * is derived (`formatCohortName`), never `"DEVCON COHORT 4"` (deviation
 * #3), and the AI quote is passed in already-rendered rather than fetched
 * here — the caller is responsible for calling `dailyQuote` (deviation #4;
 * see `standupPush.ts`), which is also what keeps this function itself
 * synchronous and trivially testable with no model at all.
 *
 * This is the **only** place the quote and the books-reminder line appear —
 * the plain-text `/standup` command's `formatStandup`/`formatStandupFiltered`
 * (issue #103) are untouched, including their own `overview` filter.
 */

export interface StandupOverviewCardOptions {
  now: Date;
  /** Already-rendered HTML quote block (from `dailyQuote`), or `''` when the
   * model was unavailable/failed/returned nothing — in which case the quote
   * is omitted entirely, with no stray blank line left behind. */
  quote: string;
}

function manilaISODate(date: Date): string {
  return DateTime.fromJSDate(date, { zone: MANILA_ZONE }).toFormat("yyyy-MM-dd");
}

function manilaDayOf(timestamp: string): string {
  return DateTime.fromISO(timestamp, { zone: MANILA_ZONE }).toFormat("yyyy-MM-dd");
}

function doneInRange(tasks: TaskWithFlags[], startISO: string, endISO: string): TaskWithFlags[] {
  return tasks.filter((t) => {
    if (t.status !== "done") return false;
    const day = manilaDayOf(t.updatedAt);
    return day >= startISO && day <= endISO;
  });
}

/** Devie's line 261, copied verbatim — including the reference to a Cohort
 * 4 program element (see this ticket's PR body for the flag the ticket
 * itself asks to raise rather than silently reword). */
const BOOKS_REMINDER_LINE =
  "📚 <b>Reminder:</b> <i>Read and finish your assigned books, cohorts! Consistency compounds.</i>";

export function buildStandupOverviewCard(
  report: StandupReport,
  opts: StandupOverviewCardOptions,
): string {
  const lines: string[] = [
    greeting(opts.now),
    "",
    `📋 <b>${esc(formatCohortName(report.cohortId))} — Daily Stand Up</b>`,
    `<i>${esc(formatReportDate(report.today))}</i>`,
    "",
    "📊 <b>Overview</b>",
    `🔄 In progress: ${report.counts.in_progress}`,
    `👀 In review: ${report.counts.in_review}`,
    `📝 To do: ${report.counts.todo}`,
    `📦 Backlog: ${report.counts.backlog}`,
    `✅ Done: ${report.counts.done}`,
    `🚧 Blocked: ${report.counts.blocked}`,
    `⚠️ Overdue: ${report.overdue}`,
  ];

  for (const section of report.details) {
    const total = section.members.reduce((n, m) => n + m.tasks.length, 0);
    lines.push("", `${STATUS_EMOJI[section.status]} <b>${esc(statusLabel(section.status))} (${total})</b>`);
    const tasks = section.members.flatMap((m) => m.tasks);
    const rendered = renderByMember(tasks);
    if (rendered) lines.push(...rendered.split("\n").filter((l, i) => !(i === 0 && l === "")));
  }

  const bounds = getWeekBounds(manilaISODate(opts.now));
  const thisWeekLabel = formatWeekLabel(bounds.thisWeekStart, bounds.thisWeekEnd);
  const lastWeekLabel = formatWeekLabel(bounds.lastWeekStart, bounds.lastWeekEnd);
  const doneThisWeek = doneInRange(report.tasks, bounds.thisWeekStart, bounds.thisWeekEnd);
  const doneLastWeek = doneInRange(report.tasks, bounds.lastWeekStart, bounds.lastWeekEnd);

  lines.push("", `✅ <b>Done this week (${thisWeekLabel})</b>`);
  if (doneThisWeek.length === 0) {
    lines.push("<i>No tasks completed this week yet.</i>");
  } else {
    for (const t of doneThisWeek) lines.push(`▸ ${esc(t.title)} (@${esc(t.assigneeUsername)})`);
  }

  lines.push("", `🗓️ <b>Done last week (${lastWeekLabel})</b>`);
  if (doneLastWeek.length === 0) {
    lines.push("<i>Nothing completed last week.</i>");
  } else {
    for (const t of doneLastWeek) lines.push(`▸ ${esc(t.title)} (@${esc(t.assigneeUsername)})`);
  }

  lines.push("", BOOKS_REMINDER_LINE);

  if (opts.quote) {
    lines.push("", opts.quote);
  }

  return lines.join("\n");
}
