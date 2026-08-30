import { readFileSync } from "node:fs";
import type { RosterEntry } from "../domain/types.js";
import { Roster } from "../domain/roster.js";

interface RosterConfigFile {
  entries: RosterEntry[];
}

/** Loads the roster config file (PRD §2/§7). Kept as a plain JSON file for
 * v1 so adding a late-joining intern is a one-line edit, not a code change;
 * swap this loader for a DB-backed one later without touching callers. */
export function loadRoster(path = "roster.config.json"): Roster {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as RosterConfigFile;
  return new Roster(parsed.entries);
}
