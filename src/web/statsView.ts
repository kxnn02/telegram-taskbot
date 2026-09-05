import type { Caller, ServiceResult } from "../domain/types.js";
import type { CohortStats, TaskService } from "../service/taskService.js";

/**
 * Presentation-only formatting for the Next.js stats page (Phase 6.2, issue
 * #17 — originally issue #4), factored out of the page component so it's
 * directly unit-testable, mirroring the removed Express dashboard's `renderStatsPage`
 * formatting steps and `taskView.ts`'s precedent of keeping pure
 * presentation logic out of the render layer. `CohortStats` itself is
 * already fully computed by `TaskService.getStats` — nothing here talks to
 * the service or re-derives a stat.
 */

/**
 * Thin data-fetching wrapper the stats page calls, mirroring
 * `oversightData.ts`'s `loadOversightView` split so the "did this caller
 * get refused" branch is directly unit-testable instead of only reachable
 * by rendering the page. `TaskService.getStats` has no access-control gate
 * of its own any more (ADR-0013) — this just calls it and returns whatever
 * `ServiceResult` comes back, success or failure, unchanged.
 */
export async function loadStatsView(
  service: Pick<TaskService, "getStats">,
  caller: Caller,
): Promise<ServiceResult<CohortStats>> {
  return service.getStats(caller);
}

export interface MemberBarViewModel {
  username: string;
  completed: number;
  /** 0-100, relative to whichever member has the most completed tasks. */
  widthPercent: number;
}

export interface StatsViewModel {
  completionRatePercentLabel: string;
  averageTimeToSubmitLabel: string;
  completedThisWeek: number;
  memberBars: MemberBarViewModel[];
}

export function buildStatsViewModel(stats: CohortStats): StatsViewModel {
  const completionRatePercentLabel = `${(stats.completionRate * 100).toFixed(1)}%`;
  const averageTimeToSubmitLabel =
    stats.averageTimeToSubmitHours === null
      ? "No submitted tasks yet"
      : `${stats.averageTimeToSubmitHours.toFixed(1)} hours`;

  const maxCompleted = Math.max(1, ...stats.completedPerMember.map((s) => s.completed));
  const memberBars: MemberBarViewModel[] = stats.completedPerMember.map((s) => ({
    username: s.username,
    completed: s.completed,
    widthPercent: Math.round((s.completed / maxCompleted) * 100),
  }));

  return {
    completionRatePercentLabel,
    averageTimeToSubmitLabel,
    completedThisWeek: stats.completedThisWeek,
    memberBars,
  };
}
