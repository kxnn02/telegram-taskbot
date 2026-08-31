import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { SupabaseRosterStore } from "./supabaseRosterStore.js";

/**
 * Contract test for `SupabaseRosterStore` (ADR-0003) against the real
 * Supabase project, mirroring the isolation strategy documented in
 * CONTEXT.md's "Contract-test isolation" note and already used by
 * `supabaseTaskStore.live.test.ts`: a uniquely-prefixed test cohort, created
 * in `beforeEach` and deleted (cascading to its roster rows) in `afterEach`.
 */

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "supabaseRosterStore.live.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);

describe("SupabaseRosterStore (live)", () => {
  let cohortId: string;

  beforeEach(async () => {
    cohortId = `__contract_test_roster_${randomUUID().slice(0, 8)}__`;
    const { error } = await client
      .from("cohorts")
      .insert({ cohort_id: cohortId, name: "Contract test cohort" });
    if (error) throw new Error(`Failed to create test cohort: ${error.message}`);
  });

  afterEach(async () => {
    // Cascades to the roster rows inserted under this cohort.
    await client.from("cohorts").delete().eq("cohort_id", cohortId);
  });

  it("lists roster rows across cohorts, mapped to RosterEntry shape", async () => {
    const { error } = await client.from("roster").insert([
      { username: "test_higherup", role: "HigherUp", cohort_id: cohortId },
      { username: "test_intern", role: "Intern", cohort_id: cohortId },
    ]);
    if (error) throw new Error(`Failed to seed roster rows: ${error.message}`);

    const store = new SupabaseRosterStore(client);
    const all = await store.listAll();

    const forThisCohort = all.filter((e) => e.cohortId === cohortId);
    expect(forThisCohort).toHaveLength(2);
    expect(forThisCohort).toContainEqual({
      username: "test_higherup",
      role: "HigherUp",
      cohortId,
    });
    expect(forThisCohort).toContainEqual({
      username: "test_intern",
      role: "Intern",
      cohortId,
    });
  });
});
