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
      { username: "test_higherup", cohort_id: cohortId },
      { username: "test_intern", cohort_id: cohortId },
    ]);
    if (error) throw new Error(`Failed to seed roster rows: ${error.message}`);

    const store = new SupabaseRosterStore(client);
    const all = await store.listAll();

    const forThisCohort = all.filter((e) => e.cohortId === cohortId);
    expect(forThisCohort).toHaveLength(2);
    expect(forThisCohort).toContainEqual({
      username: "test_higherup",
      cohortId,
    });
    expect(forThisCohort).toContainEqual({
      username: "test_intern",
      cohortId,
    });
  });

  it("upsert creates a new roster entry and records who set it", async () => {
    const store = new SupabaseRosterStore(client);
    await store.upsert({ username: "test_new", cohortId }, "test_setter");

    const { data, error } = await client
      .from("roster")
      .select("username, role, cohort_id, role_set_by, role_set_at")
      .eq("cohort_id", cohortId)
      .eq("username", "test_new")
      .single();
    if (error) throw new Error(`Failed to read back upserted row: ${error.message}`);

    expect(data).toMatchObject({
      username: "test_new",
      cohort_id: cohortId,
      role_set_by: "test_setter",
    });
    expect(data?.role_set_at).toBeTruthy();
  });

  it("upsert on an existing (cohortId, username) updates in place rather than duplicating", async () => {
    const store = new SupabaseRosterStore(client);
    await store.upsert({ username: "test_existing", cohortId }, "test_setter_1");
    await store.upsert({ username: "test_existing", cohortId }, "test_setter_2");

    const { data, error } = await client
      .from("roster")
      .select("username, role, role_set_by")
      .eq("cohort_id", cohortId)
      .eq("username", "test_existing");
    if (error) throw new Error(`Failed to read back row: ${error.message}`);

    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      username: "test_existing",
      role_set_by: "test_setter_2",
    });
  });

  it("remove deletes a roster entry", async () => {
    const store = new SupabaseRosterStore(client);
    await store.upsert({ username: "test_removable", cohortId }, "test_setter");

    await store.remove(cohortId, "test_removable");

    const { data, error } = await client
      .from("roster")
      .select("username")
      .eq("cohort_id", cohortId)
      .eq("username", "test_removable");
    if (error) throw new Error(`Failed to read back row: ${error.message}`);
    expect(data).toHaveLength(0);
  });

  it("remove on a missing entry is a no-op", async () => {
    const store = new SupabaseRosterStore(client);
    await expect(store.remove(cohortId, "test_nobody")).resolves.toBeUndefined();
  });
});
