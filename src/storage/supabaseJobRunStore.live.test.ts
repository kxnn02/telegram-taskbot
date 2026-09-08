import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseJobRunStore } from "./supabaseJobRunStore.js";

/**
 * Contract test for `SupabaseJobRunStore` (issue #43) against the real
 * Supabase project: proves a recorded run actually round-trips through
 * Postgres, including a null `detail` on success and a non-null `detail`
 * on error.
 */

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "supabaseJobRunStore.live.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);
const TEST_JOB_NAME = "test-job-runs-live";

describe("SupabaseJobRunStore (live)", () => {
  afterEach(async () => {
    await client.from("job_runs").delete().eq("job_name", TEST_JOB_NAME);
  });

  it("records a success run with a null detail", async () => {
    const store = new SupabaseJobRunStore(client);
    await store.record(TEST_JOB_NAME, "success", null);

    const { data, error } = await client
      .from("job_runs")
      .select("job_name, status, detail")
      .eq("job_name", TEST_JOB_NAME);
    expect(error).toBeNull();
    expect(data).toEqual([{ job_name: TEST_JOB_NAME, status: "success", detail: null }]);
  });

  it("records an error run with its detail message", async () => {
    const store = new SupabaseJobRunStore(client);
    await store.record(TEST_JOB_NAME, "error", "db down");

    const { data, error } = await client
      .from("job_runs")
      .select("job_name, status, detail")
      .eq("job_name", TEST_JOB_NAME);
    expect(error).toBeNull();
    expect(data).toEqual([{ job_name: TEST_JOB_NAME, status: "error", detail: "db down" }]);
  });
});
