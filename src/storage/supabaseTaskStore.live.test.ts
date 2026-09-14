import "dotenv/config";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
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

describe("SupabaseTaskStore retry regression tests", () => {
  beforeEach(async () => {
    cohortIds = [];
  });

  afterEach(async () => {
    if (cohortIds.length === 0) return;
    const { error } = await client.from("cohorts").delete().in("cohort_id", cohortIds);
    if (error) {
      throw new Error(
        `Failed to clean up test cohorts ${cohortIds.join(", ")}: ${error.message}`,
      );
    }
  });

  it("listTasksByCohort recovers when the first tasks query throws a Gateway Timeout", async () => {
    const cohortId = await makeCohort();
    const store = new SupabaseTaskStore(client);

    // Set up a task to fetch
    const id = await store.nextId(cohortId);
    await store.insertTask({
      id,
      cohortId,
      title: "Test task",
      description: undefined,
      assigneeUsername: "alice",
      assignedByUsername: "bob",
      dueDate: "2026-09-15",
      status: "todo",
      previousStatus: null,
      blockedReason: null,
      priority: "medium",
      orderIndex: 0,
      notes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock the client's from() method to throw on first call, succeed on second
    let taskQueryCount = 0;
    const originalFrom = client.from.bind(client);
    vi.spyOn(client, "from").mockImplementation(function (table: string) {
      if (table === "tasks") {
        taskQueryCount++;
        if (taskQueryCount === 1) {
          // First call to tasks table fails with Gateway Timeout
          const error = new Error("Gateway Timeout");
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  error,
                  data: null,
                }),
              }),
            }),
          } as never;
        }
      }
      // All other calls succeed normally
      return originalFrom(table);
    });

    // The first call to listTasksByCohort should retry and succeed
    const tasks = await store.listTasksByCohort(cohortId);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0]?.title).toBe("Test task");
  });

  it("listTasksByCohort propagates non-transient errors immediately without retrying", async () => {
    const cohortId = await makeCohort();
    const store = new SupabaseTaskStore(client);

    // Mock the client's from() method to always throw a non-transient error
    let taskQueryCount = 0;
    const originalFrom = client.from.bind(client);
    vi.spyOn(client, "from").mockImplementation(function (table: string) {
      if (table === "tasks") {
        taskQueryCount++;
        // First call fails with a non-transient error
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                error: new Error('column "nonexistent" does not exist'),
                data: null,
              }),
            }),
          }),
        } as never;
      }
      return originalFrom(table);
    });

    try {
      // The call should fail immediately without retrying
      await expect(store.listTasksByCohort(cohortId)).rejects.toThrow(
        'column "nonexistent" does not exist',
      );
      expect(taskQueryCount).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
