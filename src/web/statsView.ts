import type { CohortStats } from "../service/taskService.js";

/**
 * Presentation-only formatting for the Next.js stats page (Phase 6.2, issue
 * #17 — originally issue #4), factored out of the page component so it's
 * directly unit-testable, mirroring `dashboardServer.ts`'s `renderStatsPage`
 * formatting steps and `taskView.ts`'s precedent of keeping pure
 * presentation logic out of the render layer. `CohortStats` itself is
 * already fully computed by `TaskService.getStats` — nothing here talks to
 * the service or re-derives a stat.
 */

export interface InternBarViewModel {
  username: string;
  completed: number;
  /** 0-100, relative to whichever intern has the most completed tasks. */
  widthPercent: number;
}

export interface StatsViewModel {
  completionRatePercentLabel: string;
  averageTimeToSubmitLabel: string;
  completedThisWeek: number;
  internBars: InternBarViewModel[];
}

export function buildStatsViewModel(stats: CohortStats): StatsViewModel {
  const completionRatePercentLabel = `${(stats.completionRate * 100).toFixed(1)}%`;
  const averageTimeToSubmitLabel =
    stats.averageTimeToSubmitHours === null
      ? "No submitted tasks yet"
      : `${stats.averageTimeToSubmitHours.toFixed(1)} hours`;

  const maxCompleted = Math.max(1, ...stats.completedPerIntern.map((s) => s.completed));
  const internBars: InternBarViewModel[] = stats.completedPerIntern.map((s) => ({
    username: s.username,
    completed: s.completed,
    widthPercent: Math.round((s.completed / maxCompleted) * 100),
  }));

  return {
    completionRatePercentLabel,
    averageTimeToSubmitLabel,
    completedThisWeek: stats.completedThisWeek,
    internBars,
  };
}
