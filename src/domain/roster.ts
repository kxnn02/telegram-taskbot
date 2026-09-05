import type { RosterEntry } from "./types.js";

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
  private entries: RosterEntry[];
  private byCohortAndUsername = new Map<string, RosterEntry>();

  constructor(entries: RosterEntry[]) {
    this.entries = entries;
    for (const entry of entries) {
      this.byCohortAndUsername.set(this.key(entry.cohortId, entry.username), entry);
    }
  }

  /**
   * Replaces the roster's contents in place (R1/issue #86): a per-request
   * refresh so a role edited in Supabase takes effect on the next request
   * instead of whenever this Lambda instance next goes cold.
   *
   * The replacement `Map` is built fully before either field is swapped in,
   * so a concurrent reader (Fluid Compute reuses one instance across
   * concurrent requests) never observes a half-populated map.
   */
  replaceAll(entries: RosterEntry[]): void {
    const byCohortAndUsername = new Map<string, RosterEntry>();
    for (const entry of entries) {
      byCohortAndUsername.set(this.key(entry.cohortId, entry.username), entry);
    }
    this.entries = entries;
    this.byCohortAndUsername = byCohortAndUsername;
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

  /** Any known roster member in this cohort — there is no role tier any
   * more (ADR-0013): assignment/read/write access is open to the whole
   * roster. */
  isMember(username: string, cohortId: string): boolean {
    const entry = this.find(username, cohortId);
    return entry !== undefined && entry.cohortId === cohortId;
  }

  all(): RosterEntry[] {
    return [...this.entries];
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}
