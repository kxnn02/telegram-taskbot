import type { RosterEntry, Role } from "./types.js";

/**
 * The roster: every known person for a cohort, mapped from Telegram username
 * to role. This is intentionally plain data (not tied to any storage engine)
 * so it can be swapped for a config file, env var, or DB table without
 * touching callers. See PRD §2, §7.
 *
 * Usernames are stored and looked up case-insensitively and without a
 * leading "@", since Telegram usernames are case-insensitive.
 */
export class Roster {
  private readonly byUsername = new Map<string, RosterEntry>();

  constructor(entries: RosterEntry[]) {
    for (const entry of entries) {
      this.byUsername.set(normalizeUsername(entry.username), entry);
    }
  }

  find(username: string): RosterEntry | undefined {
    return this.byUsername.get(normalizeUsername(username));
  }

  isIntern(username: string, cohortId: string): boolean {
    const entry = this.find(username);
    return entry?.role === "Intern" && entry.cohortId === cohortId;
  }

  isHigherUp(username: string, cohortId: string): boolean {
    const entry = this.find(username);
    return entry?.role === "HigherUp" && entry.cohortId === cohortId;
  }

  roleOf(username: string): Role | undefined {
    return this.find(username)?.role;
  }

  all(): RosterEntry[] {
    return [...this.byUsername.values()];
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}
