import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProcessedUpdatesStorePort } from "./processedUpdatesStorePort.js";

/**
 * Real `ProcessedUpdatesStorePort` implementation over the Supabase
 * `processed_telegram_updates` table (ADR-0004/ADR-0006). Claims an update
 * id via a single atomic `INSERT ... ON CONFLICT (update_id) DO NOTHING`
 * (supabase-js: `upsert(..., { ignoreDuplicates: true })` plus
 * `.select()`), deliberately not a `SELECT` followed by an `INSERT` — see
 * `ProcessedUpdatesStorePort`'s doc comment for why. When the row already
 * existed, PostgREST's `ON CONFLICT DO NOTHING RETURNING *` returns zero
 * rows, which is exactly the "already claimed" signal this checks for.
 */
export class SupabaseProcessedUpdatesStore implements ProcessedUpdatesStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async claim(updateId: number): Promise<boolean> {
    const { data, error } = await this.client
      .from("processed_telegram_updates")
      .upsert({ update_id: updateId }, { onConflict: "update_id", ignoreDuplicates: true })
      .select();
    if (error) {
      throw new Error(`claim(${updateId}) failed: ${error.message}`);
    }
    return (data ?? []).length > 0;
  }
}
