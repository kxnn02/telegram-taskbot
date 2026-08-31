import type { RosterEntry } from "../domain/types.js";

/**
 * Storage port for the roster (ADR-0003): who belongs to a cohort and in
 * what role. Replaces the old `roster.config.json`/`roster.local.json`
 * file-based loader, which can't survive a Vercel deployment (a gitignored
 * file is not in the deployment). Returns every entry across every
 * cohort — small enough (~8 rows across the real cohort and the dry-run
 * cohort combined) that callers just wrap the result in a `Roster` and
 * filter by `cohortId` themselves, the same shape the file-based loader
 * always produced.
 */
export interface RosterStorePort {
  listAll(): Promise<RosterEntry[]>;
}
