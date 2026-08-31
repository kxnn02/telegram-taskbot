import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { sweepStaleTestCohorts, TEST_COHORT_PREFIX } from "./sweepStaleTestCohorts.js";

/**
 * Verifies `sweepStaleTestCohorts` against the real project: a stale
 * leftover test cohort (simulating a crashed run's `afterEach` never
 * firing) gets deleted, a fresh test cohort and an ordinary cohort don't.
 * See CONTEXT.md's "Contract-test isolation" note for why this sweep
 * exists at all.
 */

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "sweepStaleTestCohorts.live.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);
const runId = randomUUID().slice(0, 8);
const cleanupIds: string[] = [];

async function insertCohort(cohortId: string, createdAt: Date): Promise<void> {
  const { error } = await client
    .from("cohorts")
    .insert({ cohort_id: cohortId, name: "Sweep test cohort", created_at: createdAt.toISOString() });
  if (error) throw new Error(`Failed to insert cohort ${cohortId}: ${error.message}`);
  cleanupIds.push(cohortId);
}

async function cohortExists(cohortId: string): Promise<boolean> {
  const { data, error } = await client
    .from("cohorts")
    .select("cohort_id")
    .eq("cohort_id", cohortId)
    .maybeSingle();
  if (error) throw new Error(`Failed to check cohort ${cohortId}: ${error.message}`);
  return data !== null;
}

afterEach(async () => {
  if (cleanupIds.length === 0) return;
  await client.from("cohorts").delete().in("cohort_id", cleanupIds);
  cleanupIds.length = 0;
});

describe("sweepStaleTestCohorts (live)", () => {
  it("deletes a stale test cohort but leaves a fresh test cohort and an ordinary cohort alone", async () => {
    const staleId = `${TEST_COHORT_PREFIX}${runId}_stale__`;
    const freshId = `${TEST_COHORT_PREFIX}${runId}_fresh__`;
    const ordinaryId = `not_a_test_cohort_${runId}`;

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await insertCohort(staleId, twoHoursAgo);
    await insertCohort(freshId, new Date());
    await insertCohort(ordinaryId, twoHoursAgo);

    const deleted = await sweepStaleTestCohorts(client, 60 * 60 * 1000);

    expect(deleted).toContain(staleId);
    expect(deleted).not.toContain(freshId);
    expect(deleted).not.toContain(ordinaryId);
    expect(await cohortExists(staleId)).toBe(false);
    expect(await cohortExists(freshId)).toBe(true);
    expect(await cohortExists(ordinaryId)).toBe(true);
  });
});
