import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Builds the one `SupabaseClient` production code talks to the database
 * through, using the service-role key — RLS is enabled with zero policies
 * on every table (ADR-0006), a deny-by-default backstop, not the primary
 * authorization layer, which stays in `TaskService` (ADR-0002). The
 * service-role key bypasses RLS entirely, same as it would for the
 * anon key against a table with no policies (both get nothing) except it
 * lets the trusted server-side app actually read/write.
 */
export function createSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Copy .env.example to .env and fill them in.",
    );
  }
  return createClient(url, serviceRoleKey);
}
