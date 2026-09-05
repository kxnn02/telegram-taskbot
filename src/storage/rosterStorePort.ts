import type { RosterEntry } from "../domain/types.js";

/**
 * Storage port for the roster (ADR-0003): who belongs to a cohort. There is
 * no role tier any more (ADR-0013) — the roster is a plain membership list,
 * now populated by the bot's auto-registration rather than by an admin.
 * Returns every entry across every cohort — small enough that callers just
 * wrap the result in a `Roster` and filter by `cohortId` themselves.
 */
export interface RosterStorePort {
  listAll(): Promise<RosterEntry[]>;

  /** Creates or updates one roster entry, recording who (or what) caused
   *  it — the sender themself for auto-registration. Keyed on the table's
   *  real unique constraint, (cohort_id, username). */
  upsert(entry: RosterEntry, setBy: string): Promise<void>;

  /** Removes one roster entry. No-op if it doesn't exist. */
  remove(cohortId: string, username: string): Promise<void>;
}
