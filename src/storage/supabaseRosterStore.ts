import type { SupabaseClient } from "@supabase/supabase-js";
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
}
