import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { createSupabaseClient } from "../src/storage/supabaseClient.js";
import { buildSeedPlan, type RosterEntry } from "../src/ops/rosterSeedPlan.js";

/**
 * Seed script for the `cohorts` and `roster` tables (ADR-0003/ADR-0006), run
 * manually rather than as a migration: a SQL migration is committed to a
 * public repo, and real Telegram usernames shouldn't be (the same reason
 * `roster.local.json` is gitignored — see ADR-0003's Context section). This
 * script contains no real usernames itself; it reads them from
 * `roster.local.json` (gitignored) and from the `DRYRUN_*` env vars in this
 * worktree's local `.env` (also gitignored), so it's safe to commit.
 *
 *   npm run seed:roster                          # dry-run cohort only (default)
 *   npm run seed:roster -- --include-production  # also the live cohort
 *
 * **Defaults to the dry-run cohort only** (ADR-0011). Before the cutover this
 * script wrote both cohorts unconditionally, which was safe when the real
 * cohort had no live group chat and no self-registered roster. Neither is
 * true any more: the live cohort's rows are now production data — its
 * `group_chat_id` is where every digest is delivered, and its roster is built
 * by `/start` (ADR-0010), not by `roster.local.json`, which is now a stale
 * local file. Touching them takes a deliberate flag; what the plan writes in
 * either mode is decided (and unit-tested) in `src/ops/rosterSeedPlan.ts`.
 *
 * Idempotent: every write is an upsert keyed on the table's real unique
 * constraint (`cohort_id` for cohorts, `(cohort_id, username)` for roster),
 * so re-running it just updates rows in place rather than erroring or
 * duplicating.
 */

interface RosterConfigFile {
  entries: RosterEntry[];
}

function readRosterEntries(): RosterEntry[] {
  const rosterPath = process.env.ROSTER_PATH ?? "roster.local.json";
  if (!existsSync(rosterPath)) {
    throw new Error(
      `${rosterPath} not found — --include-production reads real roster entries from it. ` +
        "See docs/adr/0010-group-gated-registration-and-roster-management.md for the roster row shape.",
    );
  }
  const parsed = JSON.parse(readFileSync(rosterPath, "utf-8")) as RosterConfigFile;
  return parsed.entries;
}

async function main() {
  const includeProduction = process.argv.slice(2).includes("--include-production");
  const supabase = createSupabaseClient();

  const realCohortId = process.env.ACTIVE_COHORT_ID ?? "cohort-5";

  // Read before writing, so the plan can preserve any group_chat_id that is
  // already set rather than overwriting a live value with config.
  const { data: existingCohorts, error: readError } = await supabase
    .from("cohorts")
    .select("cohort_id, group_chat_id");
  if (readError) {
    throw new Error(`Failed to read existing cohorts: ${readError.message}`);
  }
  const existingGroupChatIds = Object.fromEntries(
    (existingCohorts ?? []).map((row) => [row.cohort_id, row.group_chat_id]),
  ) as Record<string, string | null>;

  const plan = buildSeedPlan({
    scope: includeProduction ? "all" : "dry-run-only",
    realCohortId,
    dryRunCohortId: process.env.DRYRUN_COHORT_ID,
    dryRunGroupChatId: process.env.DRYRUN_GROUP_CHAT_ID,
    existingGroupChatIds,
    rosterEntries: includeProduction ? readRosterEntries() : [],
    dryRunHigherUpUsername: process.env.DRYRUN_HIGHERUP_USERNAME,
    dryRunInternUsername: process.env.DRYRUN_INTERN_USERNAME,
  });

  /* eslint-disable no-console */
  console.log(
    includeProduction
      ? "Scope: live cohort + dry-run cohort (--include-production)."
      : "Scope: dry-run cohort only. Pass --include-production to also write the live cohort.",
  );

  if (plan.cohortRows.length === 0 && plan.rosterRows.length === 0) {
    console.log("Nothing to seed — is DRYRUN_COHORT_ID set?");
    return;
  }

  if (plan.cohortRows.length > 0) {
    const { error } = await supabase
      .from("cohorts")
      .upsert(plan.cohortRows, { onConflict: "cohort_id" });
    if (error) {
      throw new Error(`Failed to seed cohorts: ${error.message}`);
    }
    console.log(`Seeded cohorts: ${plan.cohortRows.map((c) => c.cohort_id).join(", ")}`);
  }

  if (plan.rosterRows.length > 0) {
    const { error } = await supabase
      .from("roster")
      .upsert(plan.rosterRows, { onConflict: "cohort_id,username" });
    if (error) {
      throw new Error(`Failed to seed roster: ${error.message}`);
    }
    console.log(
      `Seeded ${plan.rosterRows.length} roster row(s) across: ` +
        `${[...new Set(plan.rosterRows.map((r) => r.cohort_id))].join(", ")}`,
    );
  } else {
    console.log("No roster rows to seed.");
  }
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
