/**
 * Pure drift detection between `supabase/migrations/` and the production
 * database (issue #99 / ADR-0012).
 *
 * `supabase migration list --output-format json` exits 0 even when local and
 * remote disagree, so the exit code cannot be trusted as the gate — the JSON
 * payload has to be parsed and compared. This file has no I/O; the runner in
 * `scripts/checkMigrationsApplied.ts` does the spawning and parses this
 * module's output into a process exit code.
 */

export interface MigrationListEntry {
  local: string;
  remote: string;
  time: string;
}

export interface MigrationDrift {
  /** In supabase/migrations/ but never applied to the database. */
  unapplied: string[];
  /** Applied to the database but absent from supabase/migrations/. */
  untracked: string[];
}

/**
 * The CLI writes a "Connecting to remote database..." progress line to
 * stdout ahead of the JSON payload, so the payload is taken as the last
 * non-empty line rather than assuming stdout is pure JSON. Throwing (rather
 * than returning an empty array) on unparseable input matters here: silently
 * treating "nothing parsed" as "nothing drifted" would make the whole CI
 * check pass vacuously, which is the exact failure mode this ticket exists
 * to close.
 */
export function parseMigrationList(stdout: string): MigrationListEntry[] {
  const lines = stdout.split("\n").map((line) => line.trim());
  const lastNonEmpty = [...lines].reverse().find((line) => line.length > 0);

  if (!lastNonEmpty) {
    throw new Error(
      `migration list produced no output to parse. Raw stdout: ${stdout.slice(0, 2000)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastNonEmpty);
  } catch {
    throw new Error(
      `migration list did not print parseable JSON. Raw stdout: ${stdout.slice(0, 2000)}`,
    );
  }

  const migrations = (parsed as { migrations?: MigrationListEntry[] } | null)?.migrations;
  if (!Array.isArray(migrations)) {
    throw new Error(
      `migration list JSON had no "migrations" array. Raw stdout: ${stdout.slice(0, 2000)}`,
    );
  }

  return migrations;
}

export function findMigrationDrift(entries: MigrationListEntry[]): MigrationDrift {
  const unapplied = entries.filter((entry) => entry.local && !entry.remote).map((entry) => entry.local);
  const untracked = entries.filter((entry) => !entry.local && entry.remote).map((entry) => entry.remote);
  return { unapplied, untracked };
}

export function formatDriftReport(drift: MigrationDrift): string {
  const lines: string[] = [];

  if (drift.unapplied.length > 0) {
    lines.push("Local migrations never applied to the database:");
    for (const version of drift.unapplied) {
      lines.push(`  - ${version}`);
    }
    lines.push("Run `supabase db push` to apply them before merging.");
  }

  if (drift.untracked.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Migrations applied to the database but absent from supabase/migrations/:");
    for (const version of drift.untracked) {
      lines.push(`  - ${version}`);
    }
  }

  return lines.join("\n");
}
