import "dotenv/config";
import { spawnSync } from "node:child_process";
import { findMigrationDrift, formatDriftReport, parseMigrationList } from "../src/migrations/migrationDrift.js";

/**
 * CI gate for issue #99 / ADR-0012: fails when `supabase/migrations/` has a
 * migration that has never been applied to production. The Supabase CLI
 * exits 0 even when local and remote disagree, so this script parses the
 * JSON payload rather than trusting the exit code — see
 * `src/migrations/migrationDrift.ts` for the parsing itself, which is pure
 * and unit-tested.
 */

/** Never let a password reach a log line — `--db-url`'s value included. */
function redact(text: string, dbUrl: string): string {
  return text.split(dbUrl).join("<redacted>");
}

function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error(
      "SUPABASE_DB_URL is not set. This check cannot run without it — refusing to exit 0, " +
        "which would silently stop gating migrations.",
    );
    process.exit(1);
  }

  // Node refuses to spawn a .cmd/.bat file on Windows without `shell: true`
  // (CVE-2024-27980) — the npm-installed CLI is such a shim there. The Linux
  // CI runner, where this actually gates PRs, has a plain "supabase" binary
  // and runs with `shell: false`, so args are never shell-concatenated
  // there. On Windows this is local-dev convenience only, running against a
  // connection string the developer already trusts (their own .env).
  const result = spawnSync("supabase", ["migration", "list", "--db-url", dbUrl, "--output-format", "json"], {
    encoding: "utf-8",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(redact(`Failed to run the Supabase CLI: ${result.error.message}`, dbUrl));
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(redact(`supabase migration list exited ${result.status}:`, dbUrl));
    console.error(redact(result.stderr, dbUrl));
    process.exit(1);
  }

  const entries = parseMigrationList(result.stdout);
  const drift = findMigrationDrift(entries);

  if (drift.unapplied.length === 0 && drift.untracked.length === 0) {
    console.log(`${entries.length} migration(s) in sync with production.`);
    return;
  }

  console.error(formatDriftReport(drift));
  process.exit(1);
}

main();
