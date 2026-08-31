import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { SupabaseTaskStore } from "./supabaseTaskStore.js";
import { runTaskStoreContractTests, type ContractFixture } from "./taskStoreContract.js";

/**
 * Runs the shared TaskStorePort contract against the real Supabase project
 * (ADR-0005/ADR-0006) — the one shared project also used for real cohort
 * data and the dry-run cohort, so this suite must leave zero permanent
 * footprint (see CONTEXT.md's "Contract-test isolation" note for why a
 * literal transaction-rollback-per-test, as ADR-0005 originally proposed,
 * isn't achievable through supabase-js/PostgREST, and what's done instead).
 *
 * Isolation strategy: every test run gets its own uniquely-prefixed cohort
 * ids, inserted into `cohorts` in `beforeEach` and deleted in `afterEach`.
 * Deleting the cohort row cascades (see the cascade-deletes migration) to
 * every row in `cohort_counters`/`tasks`/`notes` created under it, so
 * cleanup is a single delete regardless of what a given test wrote.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role: RLS is
 * enabled with zero policies per ADR-0006, so the anon key can't do
 * anything here — this mirrors how the real app talks to Supabase).
 */

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "supabaseTaskStore.live.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
      "(see .env.example) — this suite talks to the real shared Supabase project.",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);

const runId = randomUUID().slice(0, 8);
let cohortIds: string[] = [];

async function makeCohort(): Promise<string> {
  const cohortId = `__contract_test_${runId}_${cohortIds.length}__`;
  const { error } = await client
    .from("cohorts")
    .insert({ cohort_id: cohortId, name: "Contract test cohort" });
  if (error) throw new Error(`Failed to create test cohort: ${error.message}`);
  cohortIds.push(cohortId);
  return cohortId;
}

async function setup(): Promise<ContractFixture> {
  cohortIds = [];
  const cohortId = await makeCohort();
  const otherCohortId = await makeCohort();
  return { store: new SupabaseTaskStore(client), cohortId, otherCohortId };
}

async function teardown(): Promise<void> {
  if (cohortIds.length === 0) return;
  const { error } = await client.from("cohorts").delete().in("cohort_id", cohortIds);
  if (error) {
    throw new Error(
      `Failed to clean up test cohorts ${cohortIds.join(", ")}: ${error.message}`,
    );
  }
}

runTaskStoreContractTests("SupabaseTaskStore (live)", setup, teardown);
