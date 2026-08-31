import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { SupabaseProcessedUpdatesStore } from "./supabaseProcessedUpdatesStore.js";

/**
 * Contract test for `SupabaseProcessedUpdatesStore` (ADR-0004) against the
 * real Supabase project: proves the atomic claim actually round-trips
 * through Postgres and that a repeat claim of the same update_id is
 * refused, including under concurrent claims (the exact race the
 * SELECT-then-INSERT approach this deliberately avoids would fail).
 */

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "supabaseProcessedUpdatesStore.live.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);

describe("SupabaseProcessedUpdatesStore (live)", () => {
  let updateId: number;

  afterEach(async () => {
    await client.from("processed_telegram_updates").delete().eq("update_id", updateId);
  });

  it("claims a new update id and refuses a second claim", async () => {
    updateId = randomInt(1_000_000_000, 2_000_000_000);
    const store = new SupabaseProcessedUpdatesStore(client);

    expect(await store.claim(updateId)).toBe(true);
    expect(await store.claim(updateId)).toBe(false);
  });

  it("only one of two concurrent claims of the same update id wins", async () => {
    updateId = randomInt(1_000_000_000, 2_000_000_000);
    const store = new SupabaseProcessedUpdatesStore(client);

    const [first, second] = await Promise.all([store.claim(updateId), store.claim(updateId)]);
    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
  });
});
