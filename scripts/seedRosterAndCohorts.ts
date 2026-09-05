import "dotenv/config";
import { createSupabaseClient } from "../src/storage/supabaseClient.js";
import { buildSeedPlan } from "../src/ops/rosterSeedPlan.js";

/**
 * Seed script for the `cohorts` table (ADR-0003/ADR-0006), run manually
 * rather than as a migration: a SQL migration is committed to a public
 * repo, and a cohort's live group chat id shouldn't be.
 *
 *   npm run seed:roster                          # dry-run cohort only (default)
 *   npm run seed:roster -- --include-production  # also the live cohort
 *
 * **Defaults to the dry-run cohort only** (ADR-0011). Before the cutover this
 * script wrote both cohorts unconditionally, which was safe when the real
 * cohort had no live group chat. That's no longer true: the live cohort's
 * row is now production data — its `group_chat_id` is where every digest
 * and standup is delivered. Touching it takes a deliberate flag; what the
 * plan writes in either mode is decided (and unit-tested) in
 * `src/ops/rosterSeedPlan.ts`.
 *
 * No longer seeds the `roster` table (ADR-0013): the roster is now
 * populated by the bot's auto-registration on first contact, not by an
 * admin-maintained `roster.local.json` — see the ticket for #106. This
 * script cannot write live roster rows from a stale file any more, because
 * it no longer reads one at all.
 *
 * Idempotent: every write is an upsert keyed on the table's real unique
 * constraint (`cohort_id`), so re-running it just updates the row in place
 * rather than erroring or duplicating.
 */

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
  });

  /* eslint-disable no-console */
  console.log(
    includeProduction
      ? "Scope: live cohort + dry-run cohort (--include-production)."
      : "Scope: dry-run cohort only. Pass --include-production to also write the live cohort.",
  );

  if (plan.cohortRows.length === 0) {
    console.log("Nothing to seed — is DRYRUN_COHORT_ID set?");
    return;
  }

  const { error } = await supabase
    .from("cohorts")
    .upsert(plan.cohortRows, { onConflict: "cohort_id" });
  if (error) {
    throw new Error(`Failed to seed cohorts: ${error.message}`);
  }
  console.log(`Seeded cohorts: ${plan.cohortRows.map((c) => c.cohort_id).join(", ")}`);
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
