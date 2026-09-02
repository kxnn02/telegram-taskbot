import { describe, expect, it } from "vitest";
import type { Caller } from "../domain/types.js";
import type { CohortStats, TaskService } from "../service/taskService.js";
import { buildStatsViewModel, loadStatsView } from "./statsView.js";

/**
 * Presentation-only formatting for the Next.js stats page (Phase 6.2, issue
 * #17 — originally issue #4), factored out so the page component stays a
 * thin render layer, mirroring taskView.ts's precedent of pulling pure
 * formatting logic out of the removed Express dashboard's render functions. No
 * TaskService/authorization logic here — `CohortStats` is already fully
 * computed by `TaskService.getStats`.
 */

function stats(overrides: Partial<CohortStats> = {}): CohortStats {
  return {
    completedPerIntern: [],
    completionRate: 0,
    averageTimeToSubmitHours: null,
    completedThisWeek: 0,
    ...overrides,
  };
}

describe("buildStatsViewModel", () => {
  it("formats the completion rate as a one-decimal percentage", () => {
    const model = buildStatsViewModel(stats({ completionRate: 0.6666 }));
    expect(model.completionRatePercentLabel).toBe("66.7%");
  });

  it("formats zero completion rate", () => {
    const model = buildStatsViewModel(stats({ completionRate: 0 }));
    expect(model.completionRatePercentLabel).toBe("0.0%");
  });

  it("labels a null average time to submit as no data yet", () => {
    const model = buildStatsViewModel(stats({ averageTimeToSubmitHours: null }));
    expect(model.averageTimeToSubmitLabel).toBe("No submitted tasks yet");
  });

  it("formats a numeric average time to submit in hours", () => {
    const model = buildStatsViewModel(stats({ averageTimeToSubmitHours: 12.34 }));
    expect(model.averageTimeToSubmitLabel).toBe("12.3 hours");
  });

  it("passes completedThisWeek through unchanged", () => {
    const model = buildStatsViewModel(stats({ completedThisWeek: 4 }));
    expect(model.completedThisWeek).toBe(4);
  });

  it("computes bar width percentages relative to the max completed count", () => {
    const model = buildStatsViewModel(
      stats({
        completedPerIntern: [
          { username: "alice", completed: 4 },
          { username: "bob", completed: 2 },
          { username: "carla", completed: 0 },
        ],
      }),
    );
    expect(model.internBars).toEqual([
      { username: "alice", completed: 4, widthPercent: 100 },
      { username: "bob", completed: 2, widthPercent: 50 },
      { username: "carla", completed: 0, widthPercent: 0 },
    ]);
  });

  it("doesn't divide by zero when every intern has zero completed tasks", () => {
    const model = buildStatsViewModel(
      stats({
        completedPerIntern: [
          { username: "alice", completed: 0 },
          { username: "bob", completed: 0 },
        ],
      }),
    );
    expect(model.internBars).toEqual([
      { username: "alice", completed: 0, widthPercent: 0 },
      { username: "bob", completed: 0, widthPercent: 0 },
    ]);
  });
});

/**
 * R6/#91: once interns can log in to the dashboard, they can reach the
 * stats page and get a `fail()` back from `TaskService.getStats` (still
 * higher-up-only — that gate is untouched). `loadStatsView` is the thin
 * pass-through the page calls, so this pins down that a refusal comes back
 * as a `ServiceResult` the page can render as a clear message, not a crash.
 */
describe("loadStatsView", () => {
  const caller: Caller = { username: "alice", role: "Intern", cohortId: "cohort-5" };

  function fakeService(result: Awaited<ReturnType<TaskService["getStats"]>>): TaskService {
    return { getStats: async () => result } as unknown as TaskService;
  }

  it("propagates a refusal from a non-higher-up caller instead of throwing", async () => {
    const service = fakeService({ ok: false, error: "Only higher-ups can view cohort stats." });
    const result = await loadStatsView(service, caller);
    expect(result).toEqual({ ok: false, error: "Only higher-ups can view cohort stats." });
  });

  it("passes through a successful result unchanged", async () => {
    const value = stats({ completedThisWeek: 2 });
    const service = fakeService({ ok: true, value });
    const result = await loadStatsView(service, caller);
    expect(result).toEqual({ ok: true, value });
  });
});
