import { Roster } from "../domain/roster.js";
import type { RosterStorePort } from "../storage/rosterStorePort.js";

/** Loads the roster from Supabase (ADR-0003): reads every row across every
 * cohort via the given `RosterStorePort` and wraps them in a `Roster`, the
 * same domain object the file-based loader produced — callers are
 * unaffected by the storage swap. */
export async function loadRosterFromStore(store: RosterStorePort): Promise<Roster> {
  const entries = await store.listAll();
  return new Roster(entries);
}
