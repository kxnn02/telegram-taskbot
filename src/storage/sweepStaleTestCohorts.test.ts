import { describe, expect, it } from "vitest";
import { TEST_COHORT_PREFIX, selectStaleTestCohortIds } from "./sweepStaleTestCohorts.js";

const HOUR_MS = 60 * 60 * 1000;
const now = new Date("2026-08-31T12:00:00.000Z");

describe("selectStaleTestCohortIds", () => {
  it("selects test cohorts older than the stale threshold", () => {
    const cohorts = [
      { cohort_id: `${TEST_COHORT_PREFIX}abc123_0__`, created_at: "2026-08-31T09:00:00.000Z" },
    ];
    expect(selectStaleTestCohortIds(cohorts, now, HOUR_MS)).toEqual([
      `${TEST_COHORT_PREFIX}abc123_0__`,
    ]);
  });

  it("does not select a test cohort younger than the stale threshold", () => {
    const cohorts = [
      { cohort_id: `${TEST_COHORT_PREFIX}abc123_0__`, created_at: "2026-08-31T11:50:00.000Z" },
    ];
    expect(selectStaleTestCohortIds(cohorts, now, HOUR_MS)).toEqual([]);
  });

  it("never selects a cohort that doesn't match the test-cohort prefix, regardless of age", () => {
    const cohorts = [
      { cohort_id: "cohort-5", created_at: "2020-01-01T00:00:00.000Z" },
    ];
    expect(selectStaleTestCohortIds(cohorts, now, HOUR_MS)).toEqual([]);
  });

  it("returns an empty array when given no cohorts", () => {
    expect(selectStaleTestCohortIds([], now, HOUR_MS)).toEqual([]);
  });
});
