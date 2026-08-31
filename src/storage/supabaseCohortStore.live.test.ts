import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { SupabaseCohortStore } from "./supabaseCohortStore.js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "supabaseCohortStore.live.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);

describe("SupabaseCohortStore (live)", () => {
  let cohortId: string;

  afterEach(async () => {
    await client.from("cohorts").delete().eq("cohort_id", cohortId);
  });

  it("returns the group_chat_id for a cohort that has one", async () => {
    cohortId = `__contract_test_cohort_${randomUUID().slice(0, 8)}__`;
    const { error } = await client
      .from("cohorts")
      .insert({ cohort_id: cohortId, name: "Contract test cohort", group_chat_id: "-100999" });
    if (error) throw new Error(`Failed to create test cohort: ${error.message}`);

    const store = new SupabaseCohortStore(client);
    expect(await store.getGroupChatId(cohortId)).toBe("-100999");
  });

  it("returns undefined when group_chat_id is null", async () => {
    cohortId = `__contract_test_cohort_${randomUUID().slice(0, 8)}__`;
    const { error } = await client
      .from("cohorts")
      .insert({ cohort_id: cohortId, name: "Contract test cohort" });
    if (error) throw new Error(`Failed to create test cohort: ${error.message}`);

    const store = new SupabaseCohortStore(client);
    expect(await store.getGroupChatId(cohortId)).toBeUndefined();
  });
});
