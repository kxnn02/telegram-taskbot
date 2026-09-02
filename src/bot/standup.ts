import type { TaskService, TaskWithFlags } from "../service/taskService.js";
import type { Caller, TaskStatus } from "../domain/types.js";
import { formatTaskLine, statusLabel } from "./format.js";
import { MANILA_ZONE } from "../domain/overdue.js";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Order the five non-done statuses appear in both the overview and the
 * detail sections below. The old cohort's standup bot only ever detailed
 * the review queue, so a blocked or in-progress task stayed invisible
 * behind a bare count — every status that can hold open work gets the same
 * per-member breakdown here instead. */
const DETAIL_STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "in_review",
  "todo",
  "backlog",
  "blocked",
];

const STATUS_EMOJI: Record<TaskStatus, string> = {
  in_progress: "🔄",
  in_review: "👀",
  todo: "📝",
  backlog: "📦",
  blocked: "🚧",
  done: "✅",
};

export interface StandupMemberGroup {
  username: string;
  tasks: TaskWithFlags[];
}

export interface StandupDetailSection {
  status: TaskStatus;
  members: StandupMemberGroup[];
}

/** `/standup`'s own report shape — deliberately distinct from
 * `InternDailyCounts` (`src/notifications/digestFormat.ts`): that type is
 * counts-only by construction so the automated daily/weekly group digest
 * can never leak a task title. `/standup` is *pulled*, not pushed — someone
 * explicitly ran the command — so it's allowed to carry titles, but only
 * because it's built on this separate type rather than by widening the
 * digest's.
 */
export interface StandupReport {
  cohortId: string;
  today: Date;
  counts: Record<TaskStatus, number>;
  overdue: number;
  details: StandupDetailSection[];
  doneThisWeek: TaskWithFlags[];
}

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

/** Cohort-wide status counts and per-status/per-member detail, built from
 * every task in the caller's cohort — including `done` ones, so the
 * overview's `done` count and the `doneThisWeek` list both have data to
 * draw from. */
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

  const details = DETAIL_STATUS_ORDER.map((status) => ({
    status,
    members: groupByAssignee(tasks.filter((t) => t.status === status)),
  })).filter((section) => section.members.length > 0);

  const doneThisWeek = tasks
    .filter(
      (t) => t.status === "done" && now.getTime() - Date.parse(t.updatedAt) <= MS_PER_WEEK,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return { cohortId: caller.cohortId, today: now, counts, overdue, details, doneThisWeek };
}

/** "cohort-5" -> "Cohort 5". Roster cohort ids are lowercase hyphenated
 * words/numbers (see roster.config.json) — this just title-cases the
 * words and leaves numbers alone, with no cohort-name lookup table to
 * maintain. */
function formatCohortName(cohortId: string): string {
  return cohortId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
}

function formatReportDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: MANILA_ZONE,
  }).format(date);
}

/** Renders the `/standup` report: cohort/date header, a status-count
 * overview, a detail section per non-done status that actually has tasks,
 * and a "done this week" list. Its own formatter — see `StandupReport` for
 * why it must not call the digest's `formatGroupDailySummary`. */
export function formatStandup(report: StandupReport): string {
  const lines: string[] = [
    `${formatCohortName(report.cohortId)} — Daily Standup`,
    formatReportDate(report.today),
    "",
    "📊 Overview",
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
    lines.push(
      "",
      `${STATUS_EMOJI[section.status]} ${statusLabel(section.status)} (${total})`,
    );
    for (const member of section.members) {
      lines.push(`@${member.username}:`);
      for (const t of member.tasks) lines.push("  - " + formatTaskLine(t));
    }
  }

  lines.push("", `✅ Done this week (${report.doneThisWeek.length})`);
  if (report.doneThisWeek.length === 0) {
    lines.push("No tasks completed this week yet.");
  } else {
    for (const t of report.doneThisWeek) {
      lines.push(`- #${t.id} ${t.title} (@${t.assigneeUsername})`);
    }
  }

  return lines.join("\n");
}
