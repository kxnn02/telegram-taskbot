import { normalizeUsername } from "../domain/roster.js";
import type { RosterEntry } from "../domain/types.js";
import type { RosterStorePort } from "./rosterStorePort.js";

interface StoredEntry {
  entry: RosterEntry;
  setBy: string;
  setAt: string;
}

/**
 * In-memory `RosterStorePort` implementation: used by tests (and, for
 * now, by production wiring as a placeholder until Supabase is fully wired
 * in — see `SupabaseRosterStore`). Data lives only for the lifetime of the
 * process.
 */
export class InMemoryRosterStore implements RosterStorePort {
  private readonly byCohortAndUsername = new Map<string, StoredEntry>();

  private key(cohortId: string, username: string): string {
    return `${cohortId}::${normalizeUsername(username)}`;
  }

  async listAll(): Promise<RosterEntry[]> {
    return [...this.byCohortAndUsername.values()].map((stored) => stored.entry);
  }

  async upsert(entry: RosterEntry, setBy: string): Promise<void> {
    const normalizedUsername = normalizeUsername(entry.username);
    const key = this.key(entry.cohortId, normalizedUsername);
    this.byCohortAndUsername.set(key, {
      entry: { ...entry, username: normalizedUsername },
      setBy: normalizeUsername(setBy),
      setAt: new Date().toISOString(),
    });
  }

  async remove(cohortId: string, username: string): Promise<void> {
    this.byCohortAndUsername.delete(this.key(cohortId, username));
  }

  /** Test helper: who last set this entry's role. Not part of
   * `RosterStorePort` — the port has no read-back for the audit fields
   * since nothing needs one yet. */
  setByOf(cohortId: string, username: string): string | undefined {
    return this.byCohortAndUsername.get(this.key(cohortId, username))?.setBy;
  }
}
