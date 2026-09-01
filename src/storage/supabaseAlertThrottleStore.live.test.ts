import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { SupabaseAlertThrottleStore } from "./supabaseAlertThrottleStore.js";

/**
 * Contract test for `SupabaseAlertThrottleStore` (ADR-0007) against the real
 * Supabase project: proves both the one-shot `claim` and the windowed
 * `claimWithWindow` round-trip through Postgres correctly, including that a
 * repeat `claim` of the same key is refused (the digest-idempotency path),
 * and that `claimWithWindow` refuses a reclaim inside the window but permits
 * one again once the window has elapsed (the error-DM-throttle path).
 */

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "supabaseAlertThrottleStore.live.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);

describe("SupabaseAlertThrottleStore (live)", () => {
  let key: string;

  afterEach(async () => {
    await client.from("alert_throttle").delete().eq("throttle_key", key);
  });

  it("claims a new key and refuses a second claim", async () => {
    key = `test:claim:${randomInt(1_000_000, 2_000_000)}`;
    const store = new SupabaseAlertThrottleStore(client);

    expect(await store.claim(key)).toBe(true);
    expect(await store.claim(key)).toBe(false);
  });

  it("only one of two concurrent claims of the same key wins", async () => {
    key = `test:claim-concurrent:${randomInt(1_000_000, 2_000_000)}`;
    const store = new SupabaseAlertThrottleStore(client);

    const [first, second] = await Promise.all([store.claim(key), store.claim(key)]);
    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
  });

  it("claimWithWindow refuses a reclaim inside the window but permits one after it elapses", async () => {
    key = `test:window:${randomInt(1_000_000, 2_000_000)}`;
    const store = new SupabaseAlertThrottleStore(client);

    expect(await store.claimWithWindow(key, 60_000)).toBe(true);
    expect(await store.claimWithWindow(key, 60_000)).toBe(false);
    expect(await store.claimWithWindow(key, 0)).toBe(true);
  });
});
