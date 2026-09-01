import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertThrottleStorePort } from "./alertThrottleStorePort.js";

interface AlertThrottleRow {
  last_sent_at: string;
}

/**
 * Real `AlertThrottleStorePort` implementation over the Supabase
 * `alert_throttle` table (ADR-0007). `claim` mirrors
 * `SupabaseProcessedUpdatesStore.claim` exactly: a single atomic
 * `INSERT ... ON CONFLICT (throttle_key) DO NOTHING` (supabase-js:
 * `upsert(..., { ignoreDuplicates: true })` plus `.select()`) — zero rows
 * back means some earlier call already claimed it.
 *
 * `claimWithWindow` is a read-then-write (not a single atomic round trip):
 * it reads `last_sent_at`, decides locally whether `windowMs` has elapsed,
 * then unconditionally upserts a fresh `last_sent_at` when it has. This is a
 * deliberate, accepted looser guarantee than `claim`'s true atomicity —
 * unlike webhook dedup (bursty concurrent retries of the same update),
 * error-DM throttling only ever runs from one job invocation at a time per
 * `(jobName, cohortId)` pair, so the theoretical race (two overlapping
 * invocations of the exact same job for the exact same cohort, both reading
 * "window elapsed" before either writes) is not a realistic failure mode
 * here, and at worst produces one extra duplicate alert rather than a
 * missed one.
 */
export class SupabaseAlertThrottleStore implements AlertThrottleStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async claim(key: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("alert_throttle")
      .upsert(
        { throttle_key: key, last_sent_at: new Date().toISOString() },
        { onConflict: "throttle_key", ignoreDuplicates: true },
      )
      .select();
    if (error) {
      throw new Error(`claim(${key}) failed: ${error.message}`);
    }
    return (data ?? []).length > 0;
  }

  async claimWithWindow(key: string, windowMs: number): Promise<boolean> {
    const { data, error } = await this.client
      .from("alert_throttle")
      .select("last_sent_at")
      .eq("throttle_key", key)
      .maybeSingle();
    if (error) {
      throw new Error(`claimWithWindow(${key}) read failed: ${error.message}`);
    }
    const row = data as AlertThrottleRow | null;
    if (row) {
      const elapsed = Date.now() - new Date(row.last_sent_at).getTime();
      if (elapsed < windowMs) return false;
    }
    const { error: upsertError } = await this.client
      .from("alert_throttle")
      .upsert(
        { throttle_key: key, last_sent_at: new Date().toISOString() },
        { onConflict: "throttle_key" },
      );
    if (upsertError) {
      throw new Error(`claimWithWindow(${key}) write failed: ${upsertError.message}`);
    }
    return true;
  }
}
