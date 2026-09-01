import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `/api/jobs/keep-alive` core logic (ADR-0007): a trivial read against the
 * database, run twice weekly by Vercel Cron (not `pg_cron` — this exists
 * specifically to keep Supabase's free-tier project from auto-pausing after
 * 7 days of inactivity, so it can't itself depend on Supabase's own
 * scheduler). `cohorts` is read rather than any other table only because
 * it's small and always exists — this isn't a health check of any
 * particular feature, just "touch the database".
 */
export async function pingDatabase(client: SupabaseClient): Promise<void> {
  const { error } = await client.from("cohorts").select("cohort_id").limit(1);
  if (error) {
    throw new Error(`keep-alive ping failed: ${error.message}`);
  }
}
