import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeUsername } from "../domain/roster.js";
import type { RosterEntry, Role } from "../domain/types.js";
import type { RosterStorePort } from "./rosterStorePort.js";

interface RosterRow {
  username: string;
  role: Role;
  cohort_id: string;
}

/** Real `RosterStorePort` implementation over the Supabase `roster` table
 * (ADR-0003/ADR-0006), via the supabase-js query builder. */
export class SupabaseRosterStore implements RosterStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async listAll(): Promise<RosterEntry[]> {
    const { data, error } = await this.client.from("roster").select("username, role, cohort_id");
    if (error) {
      throw new Error(`listAll() failed: ${error.message}`);
    }
    return ((data ?? []) as RosterRow[]).map((row) => ({
      username: row.username,
      role: row.role,
      cohortId: row.cohort_id,
    }));
  }

  async upsert(entry: RosterEntry, setBy: string): Promise<void> {
    const row = {
      username: normalizeUsername(entry.username),
      role: entry.role,
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
