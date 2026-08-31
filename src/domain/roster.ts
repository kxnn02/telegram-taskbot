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
  private readonly entries: RosterEntry[];
  private readonly byCohortAndUsername = new Map<string, RosterEntry>();

  constructor(entries: RosterEntry[]) {
    this.entries = entries;
    for (const entry of entries) {
      this.byCohortAndUsername.set(this.key(entry.cohortId, entry.username), entry);
    }
  }

  private key(cohortId: string, username: string): string {
    return `${cohortId}::${normalizeUsername(username)}`;
  }

  /**
   * Looks up a roster entry by username. The dry-run cohort (ADR-0004)
   * reuses the same real Telegram accounts under a second `cohortId`, so a
   * username is no longer guaranteed unique across the whole roster the
   * way it was when only one cohort existed. Pass `cohortId` to
   * disambiguate when it's known. Without it, this returns the first
   * matching entry in the roster's insertion order — deterministic, but
   * not cohort-aware.
   *
   * Every live-request call site (`/start`, `resolveCaller`, the
   * dashboard's Telegram-login lookup) now resolves a deployment-bound
   * `cohortId` and always passes it explicitly — see CONTEXT.md's
   * "Caller resolution is bound to one cohort per deployment" entry. The
   * no-arg overload remains only for callers with no cohort in hand at
   * all (none of which are reachable from a real request as of that fix)
   * and for tests.
   */
  find(username: string, cohortId?: string): RosterEntry | undefined {
    if (cohortId !== undefined) {
      return this.byCohortAndUsername.get(this.key(cohortId, username));
    }
    const normalized = normalizeUsername(username);
    return this.entries.find((entry) => normalizeUsername(entry.username) === normalized);
  }

  isIntern(username: string, cohortId: string): boolean {
    const entry = this.find(username, cohortId);
    return entry?.role === "Intern" && entry.cohortId === cohortId;
  }

  isHigherUp(username: string, cohortId: string): boolean {
    const entry = this.find(username, cohortId);
    return entry?.role === "HigherUp" && entry.cohortId === cohortId;
  }

  roleOf(username: string): Role | undefined {
    return this.find(username)?.role;
  }

  all(): RosterEntry[] {
    return [...this.entries];
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}
