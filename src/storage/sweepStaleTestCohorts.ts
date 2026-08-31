import type { SupabaseClient } from "@supabase/supabase-js";

/** Prefix every contract-test cohort id is created with (see
 * `supabaseTaskStore.live.test.ts`) — the sweep only ever touches cohorts
 * matching this, never a real or dry-run cohort. */
export const TEST_COHORT_PREFIX = "__contract_test_";

/** One hour: long enough that no contract-test run legitimately still has
 * a cohort open (the whole live suite runs in seconds), short enough that
 * a crashed run's leftovers don't linger. */
export const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;

/** Pure filter: which of these cohorts are test-cohort leftovers old
 * enough to be safe to delete. Kept separate from the Supabase I/O below
 * so the age/prefix logic is fast-testable without hitting the network. */
export function selectStaleTestCohortIds(
  cohorts: { cohort_id: string; created_at: string }[],
  now: Date,
  staleAfterMs: number,
): string[] {
  return cohorts
    .filter((c) => c.cohort_id.startsWith(TEST_COHORT_PREFIX))
    .filter((c) => now.getTime() - new Date(c.created_at).getTime() > staleAfterMs)
    .map((c) => c.cohort_id);
}

/**
 * Belt-and-suspenders cleanup for the contract-test isolation strategy
 * (see CONTEXT.md's "Contract-test isolation" note): `afterEach` deletes
 * each test's cohort on the happy path, but a crash mid-run skips that.
 * This finds and deletes any test cohort older than `staleAfterMs`,
 * cascading (per the cascade-deletes migration) to every row created
 * under it. Safe to run repeatedly and from anywhere (CI step, scheduled
 * workflow) — it only ever touches rows matching `TEST_COHORT_PREFIX`.
 */
export async function sweepStaleTestCohorts(
  client: SupabaseClient,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): Promise<string[]> {
  const { data, error } = await client.from("cohorts").select("cohort_id, created_at");
  if (error) throw new Error(`Failed to list cohorts for sweep: ${error.message}`);

  const staleIds = selectStaleTestCohortIds(data ?? [], new Date(), staleAfterMs);
  if (staleIds.length === 0) return [];

  const { error: deleteError } = await client.from("cohorts").delete().in("cohort_id", staleIds);
  if (deleteError) {
    throw new Error(`Failed to sweep stale test cohorts ${staleIds.join(", ")}: ${deleteError.message}`);
  }
  return staleIds;
}
