import type { TaskService, TaskWithFlags } from "../service/taskService.js";
import type { Caller, TaskStatus } from "../domain/types.js";
import { formatTaskLine } from "./format.js";
import { MANILA_ZONE } from "../domain/overdue.js";
import { renderMemberBucketsPlain, standupSummaryLine } from "./standupBuckets.js";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface StandupMemberGroup {
  username: string;
  tasks: TaskWithFlags[];
}

/** `/standup`'s own report shape — deliberately distinct from the
 * notification digest's own types. `/standup` is *pulled*, not pushed —
 * someone explicitly ran the command — so it's allowed to carry titles,
 * built on this separate type rather than by widening a digest type.
 */
export interface StandupReport {
  cohortId: string;
  today: Date;
  counts: Record<TaskStatus, number>;
  overdue: number;
  doneThisWeek: TaskWithFlags[];
  /** Every task in the caller's cohort, as fetched. Added by issue #103
   * item 3 so the filter views can group across statuses (Devie's "Active"
   * tab mixes three of them) without a second fetch, and so
   * `formatStandupFiltered` stays pure like `formatStandup`. Cohort-scoped
   * by construction: it is whatever `TaskService.listAllTasks` returned. */
  tasks: TaskWithFlags[];
}

/**
 * Devie's five standup filters (`lib/standup.ts:7-11`) — the inline buttons
 * that edit the standup message in place (issue #103 item 3).
 */
export type StandupFilter = "overview" | "active" | "backlog" | "done" | "review";

export const VALID_STANDUP_FILTERS: ReadonlySet<StandupFilter> = new Set<StandupFilter>([
  "overview",
  "active",
  "backlog",
  "done",
  "review",
]);

/**
 * ISSUE #103 (item 3): the single lookup table mapping each of Devie's five
 * standup filters onto *this* repo's statuses. Devie's own data layer
 * derives each tab from a hand-written filter over its `tasks` rows
 * (`lib/standup.ts:186-192` and the `buildStandupPage` branches); this is
 * that mapping stated once, in one place, so a reader never has to diff two
 * renderers to learn what a tab shows.
 *
 * `done` is listed as the plain `done` status here, but the Done tab
 * additionally narrows to *this week's* completions — Devie's tab is
 * `doneThisWeek`, not every done task ever. See `formatStandupFiltered`.
 */
export const STANDUP_FILTER_STATUSES: Record<StandupFilter, readonly TaskStatus[]> = {
  overview: ["blocked", "in_progress", "in_review", "todo", "backlog", "done"],
  active: ["in_progress", "in_review", "todo"],
  backlog: ["backlog"],
  review: ["in_review"],
  done: ["done"],
};

/**
 * ISSUE #103 (item 3): the statuses Devie's `activeCount` sums
 * (`lib/standup.ts:209`) — which include `blocked`, even though the Active
 * tab's *list* (`lib/standup.ts:267`) does not. The button therefore reads
 * "Active (4)" over a list of three. Carbon-copied on purpose (#103 rule 2);
 * an improvement is proposed separately.
 */
export const STANDUP_ACTIVE_COUNT_STATUSES: readonly TaskStatus[] = [
  "blocked",
  "in_progress",
  "in_review",
  "todo",
];

/** Prefix on every standup inline-button payload, so one callback handler
 * can tell a standup button from a `/tasks` one. */
export const STANDUP_CALLBACK_PREFIX = "standup|";

function groupByAssignee(tasks: TaskWithFlags[]): StandupMemberGroup[] {
  const byUsername = new Map<string, TaskWithFlags[]>();
  for (const t of tasks) {
    const list = byUsername.get(t.assigneeUsername) ?? [];
    list.push(t);
    byUsername.set(t.assigneeUsername, list);
  }
  return [...byUsername.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([username, memberTasks]) => ({
      username,
      tasks: [...memberTasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    }));
}

/** Cohort-wide status counts, built from every task in the caller's cohort —
 * including `done` ones, so the overview's `done` count and the
 * `doneThisWeek` list both have data to draw from. Person-first grouping is
 * computed from `report.tasks` by `standupBuckets.ts` (#165), not here. */
export async function buildStandup(
  service: TaskService,
  caller: Caller,
  now: Date,
): Promise<StandupReport> {
  const all = await service.listAllTasks(caller);
  const tasks = all.ok ? all.value : [];

  const counts: Record<TaskStatus, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    blocked: 0,
    done: 0,
  };
  for (const t of tasks) counts[t.status]++;

  const overdue = tasks.filter((t) => t.overdue).length;

  const doneThisWeek = tasks
    .filter(
      (t) => t.status === "done" && now.getTime() - Date.parse(t.updatedAt) <= MS_PER_WEEK,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return { cohortId: caller.cohortId, today: now, counts, overdue, doneThisWeek, tasks };
}

/** "cohort-5" -> "Cohort 5". Roster cohort ids are lowercase hyphenated
 * words/numbers (see ADR-0010 for the roster row shape, since
 * roster.config.json was deleted) — this just title-cases the words and
 * leaves numbers alone, with no cohort-name lookup table to maintain. */
export function formatCohortName(cohortId: string): string {
  return cohortId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
}

export function formatReportDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: MANILA_ZONE,
  }).format(date);
}

/** The two header lines every standup view carries — cohort name and the
 * Manila-resolved report date. Shared by `formatStandup` and every filter
 * view (issue #103 item 3), which is what makes switching filters look like
 * the same card changing tabs rather than five unrelated replies. */
function standupHeaderLines(report: StandupReport): string[] {
  return [
    `${formatCohortName(report.cohortId)} — Daily Standup`,
    formatReportDate(report.today),
  ];
}

/** Renders the `/standup` report: cohort/date header, the one-line
 * Overdue/Doing/For approval/Backlog/Done summary, the person-first
 * Overdue/Doing/For approval breakdown, and a "done this week" list. Its
 * own formatter, built on `StandupReport` rather than the digest's own
 * shape. Person-first layout per #165; the plain-text mirror of the scheduled
 * HTML card's `buildStandupOverviewCard` (#165 S2).
 *
 * Issue #180: `certTipPlain`, when given, is appended as the last line,
 * preceded by a blank line — the caller renders it (`renderCertTipPlain`,
 * same pre-rendered pattern as the pushed card's `certTip`/`quote`), so this
 * function stays synchronous. Only the unfiltered `/standup` command passes
 * one; `formatStandupFiltered`'s `overview` branch calls this with no tip at
 * all, since tapping a filter button — including the Overview button itself
 * — drops the tip. There is no quote here: unlike the pushed card, `/standup`
 * never calls the model, so it always returns instantly from cached data.
 */
export function formatStandup(report: StandupReport, certTipPlain?: string): string {
  const lines: string[] = [
    ...standupHeaderLines(report),
    standupSummaryLine(report.tasks),
    ...renderMemberBucketsPlain(report.tasks),
  ];

  lines.push("", `✅ Done this week (${report.doneThisWeek.length})`);
  if (report.doneThisWeek.length === 0) {
    lines.push("No tasks completed this week yet.");
  } else {
    for (const t of report.doneThisWeek) {
      lines.push(`- #${t.id} ${t.title} (@${t.assigneeUsername})`);
    }
  }

  if (certTipPlain) {
    lines.push("", certTipPlain);
  }

  return lines.join("\n");
}

// ---- Standup filters (issue #103 item 3) --------------------------------

export interface StandupInlineButton {
  text: string;
  callback_data: string;
}

export interface StandupKeyboardMarkup {
  inline_keyboard: StandupInlineButton[][];
}

/** Reads back a `standup|<filter>|<page>` button payload. `undefined` when
 * the payload isn't a standup button, names an unknown filter, or carries a
 * non-numeric page — Devie's `VALID_STANDUP_FILTERS.has(filter) &&
 * !isNaN(page)` guard (`route.ts:661`), stated as a parser. */
export function parseStandupCallback(
  data: string,
): { filter: StandupFilter; page: number } | undefined {
  if (!data.startsWith(STANDUP_CALLBACK_PREFIX)) return undefined;
  const [, filterRaw, pageStr] = data.split("|");
  const filter = filterRaw as StandupFilter;
  if (filterRaw === undefined || !VALID_STANDUP_FILTERS.has(filter)) return undefined;
  const page = Number.parseInt(pageStr ?? "", 10);
  if (Number.isNaN(page)) return undefined;
  return { filter, page };
}

function countFor(report: StandupReport, statuses: readonly TaskStatus[]): number {
  return statuses.reduce((sum, status) => sum + report.counts[status], 0);
}

/**
 * Devie's one-row filter keyboard (`lib/standup.ts:308-323`): five buttons,
 * the active one prefixed with `· `, each carrying `standup|<filter>|0`.
 * Button labels and counts are copied verbatim, including "Active" counting
 * blocked tasks its own list omits (see STANDUP_ACTIVE_COUNT_STATUSES).
 */
export function buildStandupKeyboard(
  report: StandupReport,
  active: StandupFilter,
): StandupKeyboardMarkup {
  const btn = (f: StandupFilter, label: string): StandupInlineButton => ({
    text: f === active ? `· ${label}` : label,
    callback_data: `${STANDUP_CALLBACK_PREFIX}${f}|0`,
  });

  return {
    inline_keyboard: [
      [
        btn("overview", "📊 Overview"),
        btn("active", `Active (${countFor(report, STANDUP_ACTIVE_COUNT_STATUSES)})`),
        btn("backlog", `Backlog (${report.counts.backlog})`),
        btn("review", `Review (${report.counts.in_review})`),
        btn("done", `Done (${report.doneThisWeek.length})`),
      ],
    ],
  };
}

/** Devie's per-tab section headings and empty-state strings
 * (`lib/standup.ts:266-300`), copied verbatim apart from the HTML tags —
 * this bot's standup is plain text, so the `<b>`/`<i>` wrappers are the one
 * thing dropped. */
const FILTER_SECTION: Record<
  Exclude<StandupFilter, "overview">,
  { heading: (report: StandupReport) => string; empty: string }
> = {
  active: {
    heading: (r) => `🔄 Active (${countFor(r, STANDUP_ACTIVE_COUNT_STATUSES)})`,
    empty: "No active tasks right now.",
  },
  backlog: {
    heading: (r) => `📦 Backlog (${r.counts.backlog})`,
    empty: "Backlog is clear!",
  },
  review: {
    heading: (r) => `👀 For Review (${r.counts.in_review})`,
    empty: "Nothing waiting for review right now.",
  },
  done: {
    heading: (r) => `✅ Done this week (${r.doneThisWeek.length})`,
    empty: "No tasks completed this week yet.",
  },
};

/**
 * Renders the standup under one filter (issue #103 item 3). `overview` is
 * the existing `formatStandup` untouched — the filters are an addition to
 * this repo's standup, not a replacement for it. Every other filter is the
 * shared header plus one member-grouped section, using `STANDUP_FILTER_
 * STATUSES` for what goes in it.
 *
 * Pure, like `formatStandup`: everything it needs is already on the report,
 * which is what lets the callback handler re-render any tab from one fetch.
 */
export function formatStandupFiltered(report: StandupReport, filter: StandupFilter): string {
  if (filter === "overview") return formatStandup(report);

  const section = FILTER_SECTION[filter];
  // The Done tab is this week's completions, not every done task ever —
  // Devie's `doneThisWeek` (lib/standup.ts:294), which is also what the
  // button's count shows.
  const statuses = STANDUP_FILTER_STATUSES[filter];
  const tasks =
    filter === "done"
      ? report.doneThisWeek
      : report.tasks.filter((t) => statuses.includes(t.status));

  const lines: string[] = [...standupHeaderLines(report), "", section.heading(report)];
  if (tasks.length === 0) {
    lines.push(section.empty);
    return lines.join("\n");
  }
  for (const member of groupByAssignee(tasks)) {
    lines.push(`@${member.username}:`);
    for (const t of member.tasks) lines.push("  - " + formatTaskLine(t));
  }
  return lines.join("\n");
}
