import { isOverdue } from "../domain/overdue.js";
import type { Task } from "../domain/types.js";

/**
 * Pure view-builder for the dashboard's Overview page (issue #124 stage
 * S4, Devie's `app/dashboard/page.tsx`), same convention as
 * `boardView.ts`/`statsView.ts`: operate only on already-fetched data, no
 * I/O, no React. Overdue is computed via `isOverdue` (this repo's Manila
 * civil-date primitive) rather than Devie's raw `new Date(due) < new
 * Date()`, which is timezone-naive — a deliberate deviation, not a miss.
 */

export interface OverviewStat {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

export interface OverviewView {
  stats: OverviewStat[];
  donePercent: number;
  totalTasks: number;
  recentTasks: Task[];
  urgentCount: number;
  overdueCount: number;
}

export function buildOverviewView(tasks: Task[], now: Date): OverviewView {
  const totalTasks = tasks.length;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const donePercent = totalTasks === 0 ? 0 : Math.round((doneCount / totalTasks) * 100);
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const inReviewCount = tasks.filter((t) => t.status === "in_review").length;
  const blockedCount = tasks.filter((t) => t.status === "blocked").length;
  const urgentCount = tasks.filter((t) => t.priority === "urgent" && t.status !== "done").length;
  const overdueCount = tasks.filter((t) => isOverdue(t, now)).length;

  const recentTasks = [...tasks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 12);

  return {
    stats: [
      { key: "total", label: "Total Tasks", value: totalTasks },
      { key: "done", label: "Completed", value: doneCount, sub: `${donePercent}% rate` },
      { key: "inProgress", label: "In Progress", value: inProgressCount },
      { key: "inReview", label: "In Review", value: inReviewCount },
      { key: "blocked", label: "Blocked", value: blockedCount },
      { key: "urgent", label: "Urgent", value: urgentCount },
      { key: "overdue", label: "Overdue", value: overdueCount },
    ],
    donePercent,
    totalTasks,
    recentTasks,
    urgentCount,
    overdueCount,
  };
}
