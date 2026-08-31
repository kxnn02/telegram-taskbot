import { readFileSync } from "node:fs";
import type { RosterEntry } from "../domain/types.js";
import { Roster } from "../domain/roster.js";
import type { RosterStorePort } from "../storage/rosterStorePort.js";

interface RosterConfigFile {
  entries: RosterEntry[];
}

/** Loads the roster config file (PRD §2/§7). Superseded in production by
 * `loadRosterFromStore` below (ADR-0003) — a gitignored file doesn't exist
 * in a Vercel deployment. Kept for the dashboard (`src/web/index.ts`,
 * unaffected by this phase) and for tests that still want a quick
 * file-backed roster. */
export function loadRoster(path = "roster.config.json"): Roster {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as RosterConfigFile;
  return new Roster(parsed.entries);
}

/** Loads the roster from Supabase (ADR-0003): reads every row across every
 * cohort via the given `RosterStorePort` and wraps them in a `Roster`, the
 * same domain object the file-based loader produced — callers are
 * unaffected by the storage swap. */
export async function loadRosterFromStore(store: RosterStorePort): Promise<Roster> {
  const entries = await store.listAll();
  return new Roster(entries);
}
