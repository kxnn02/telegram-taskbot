import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeUsername } from "../domain/roster.js";
import type { RosterEntry } from "../domain/types.js";
import type { RosterStorePort } from "./rosterStorePort.js";

interface RosterRow {
  username: string;
  cohort_id: string;
}

/** Real `RosterStorePort` implementation over the Supabase `roster` table
 * (ADR-0003/ADR-0006), via the supabase-js query builder.
 *
 * The table's `role` column is untouched by this class (ADR-0013 made it
 * nullable rather than dropping it — see the migration
 * `supabase/migrations/*_roster_role_nullable.sql` — since the concept it
 * held, `Intern`/`HigherUp`, no longer exists anywhere in this codebase).
 * Every row this class writes leaves it null. */
export class SupabaseRosterStore implements RosterStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async listAll(): Promise<RosterEntry[]> {
    const { data, error } = await this.client.from("roster").select("username, cohort_id");
    if (error) {
      throw new Error(`listAll() failed: ${error.message}`);
    }
    return ((data ?? []) as RosterRow[]).map((row) => ({
      username: row.username,
      cohortId: row.cohort_id,
    }));
  }

  /** `setBy` is who (or, for auto-registration, the sender themself) caused
   * this row to exist — recorded in the same audit columns the removed
   * roster-role feature used, now repurposed as a plain "who/when" trail
   * rather than a role-change log. */
  async upsert(entry: RosterEntry, setBy: string): Promise<void> {
    const row = {
      username: normalizeUsername(entry.username),
      cohort_id: entry.cohortId,
      role_set_by: normalizeUsername(setBy),
      role_set_at: new Date().toISOString(),
    };
    const { error } = await this.client
      .from("roster")
      .upsert(row, { onConflict: "cohort_id,username" });
    if (error) {
      throw new Error(`upsert() failed: ${error.message}`);
    }
  }

  async remove(cohortId: string, username: string): Promise<void> {
    const { error } = await this.client
      .from("roster")
      .delete()
      .eq("cohort_id", cohortId)
      .eq("username", normalizeUsername(username));
    if (error) {
      throw new Error(`remove() failed: ${error.message}`);
    }
  }
}
