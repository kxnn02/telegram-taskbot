import { DateTime } from "luxon";
import type { StandupReport } from "./standup.js";
import { formatCohortName, formatReportDate } from "./standup.js";
import { greeting } from "./standupCard.js";
import { esc } from "./html.js";
import { standupSummaryLine, renderMemberBucketsHtml, renderReviewQueueHtml } from "./standupBuckets.js";
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
 * Issue #165 (S2): the header is followed by `standupSummaryLine` and the
 * three person-first buckets from `standupBuckets.ts` (Overdue / Doing /
 * For approval), not a per-status count block and detail loop. This is a
 * deliberate divergence from Devie's own `buildStandupPage("overview", ...)`,
 * which this file otherwise carbon-copies — a future parity pass must not
 * "restore" the status-first grouping this replaced.
 *
 * Issue #180: the books-reminder line is gone, replaced by a rotating
 * certification tip (`certTips.ts`) that always closes the card, quote or no
 * quote. The quote is still only ever rendered here in the pushed card —
 * `/standup`'s `formatStandup` never calls the model — but the tip itself is
 * no longer exclusive to this card: `formatStandup`'s unfiltered view also
 * appends its own plain-text render of the same day's tip.
 */

export interface StandupOverviewCardOptions {
  now: Date;
  /** Already-rendered HTML quote block (from `dailyQuote`), or `''` when the
   * model was unavailable/failed/returned nothing — in which case the quote
   * is omitted entirely, with no stray blank line left behind. */
  quote: string;
  /** Already-rendered HTML certification tip (`renderCertTipHtml`, selected
   * by `selectCertTipForDate`) — the caller renders it, same deviation as
   * `quote` above (issue #180). Always present; unlike the quote, static
   * content can't fail, so there's no empty-string fallback path here. */
  certTip: string;
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

export function buildStandupOverviewCard(
  report: StandupReport,
  opts: StandupOverviewCardOptions,
): string {
  const lines: string[] = [
    greeting(opts.now),
    "",
    `📋 <b>${esc(formatCohortName(report.cohortId))} — Daily Stand Up</b>`,
    `<i>${esc(formatReportDate(report.today))}</i>`,
    standupSummaryLine(report.tasks),
  ];

  lines.push(...renderMemberBucketsHtml(report.tasks));

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

  lines.push(...renderReviewQueueHtml(report.tasks));

  if (opts.quote) {
    lines.push("", opts.quote);
  }

  lines.push("", opts.certTip);

  return lines.join("\n");
}
