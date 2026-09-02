import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { createSupabaseClient } from "../src/storage/supabaseClient.js";

/**
 * One-off seed script for the `cohorts` and `roster` tables (ADR-0003/
 * ADR-0006), run manually (`npm run seed:roster`) rather than as a
 * migration: a SQL migration is committed to a public repo, and real
 * Telegram usernames shouldn't be (the same reason `roster.local.json` is
 * gitignored — see ADR-0003's Context section). This script contains no
 * real usernames itself; it reads them from `roster.local.json` (gitignored)
 * and from the `DRYRUN_*` env vars in this worktree's local `.env`
 * (also gitignored), so it's safe to commit.
 *
 * Idempotent: every write is an upsert keyed on the table's real unique
 * constraint (`cohort_id` for cohorts, `(cohort_id, username)` for roster),
 * so re-running this after editing roster.local.json just updates rows in
 * place rather than erroring or duplicating.
 *
 * Seeds:
 * - `cohorts`: the real cohort (`ACTIVE_COHORT_ID`, group_chat_id left NULL
 *   — the real group chat isn't finalized yet, matching today's blank
 *   GROUP_CHAT_ID) and the dry-run cohort (`DRYRUN_COHORT_ID`, group_chat_id
 *   set to the dump group `DRYRUN_GROUP_CHAT_ID`).
 * - `roster`: every entry from roster.local.json under the real cohort,
 *   plus the same two real accounts (`DRYRUN_HIGHERUP_USERNAME`,
 *   `DRYRUN_INTERN_USERNAME`) under the dry-run cohort, in the same roles
 *   they already hold in roster.local.json (ADR-0004: the dry run reuses
 *   real accounts, not a second identity per person).
 */

interface RosterConfigFile {
  entries: { username: string; role: "Intern" | "HigherUp"; cohortId: string }[];
}

async function main() {
  const supabase = createSupabaseClient();

  const realCohortId = process.env.ACTIVE_COHORT_ID ?? "cohort-5";
  const dryRunCohortId = process.env.DRYRUN_COHORT_ID;
  const dryRunGroupChatId = process.env.DRYRUN_GROUP_CHAT_ID;

  const cohortRows: { cohort_id: string; name: string; group_chat_id: string | null }[] = [
    { cohort_id: realCohortId, name: "DevCon PH Cohort 5", group_chat_id: null },
  ];
  if (dryRunCohortId) {
    cohortRows.push({
      cohort_id: dryRunCohortId,
      name: "DevCon PH Cohort 5 (dry run)",
      group_chat_id: dryRunGroupChatId ?? null,
    });
  }

  const { error: cohortError } = await supabase
    .from("cohorts")
    .upsert(cohortRows, { onConflict: "cohort_id" });
  if (cohortError) {
    throw new Error(`Failed to seed cohorts: ${cohortError.message}`);
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded cohorts: ${cohortRows.map((c) => c.cohort_id).join(", ")}`);

  const rosterPath = process.env.ROSTER_PATH ?? "roster.local.json";
  if (!existsSync(rosterPath)) {
    throw new Error(
      `${rosterPath} not found — this script reads real roster entries from it. ` +
        "See docs/adr/0010-group-gated-registration-and-roster-management.md for the roster row shape.",
    );
  }
  const parsed = JSON.parse(readFileSync(rosterPath, "utf-8")) as RosterConfigFile;

  const rosterRows = parsed.entries
    .filter((e) => e.cohortId === realCohortId)
    .map((e) => ({ username: e.username, role: e.role, cohort_id: realCohortId }));

  if (dryRunCohortId) {
    const higherUp = process.env.DRYRUN_HIGHERUP_USERNAME;
    const intern = process.env.DRYRUN_INTERN_USERNAME;
    if (higherUp) {
      rosterRows.push({ username: higherUp, role: "HigherUp", cohort_id: dryRunCohortId });
    }
    if (intern) {
      rosterRows.push({ username: intern, role: "Intern", cohort_id: dryRunCohortId });
    }
  }

  if (rosterRows.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No roster rows to seed.");
    return;
  }

  const { error: rosterError } = await supabase
    .from("roster")
    .upsert(rosterRows, { onConflict: "cohort_id,username" });
  if (rosterError) {
    throw new Error(`Failed to seed roster: ${rosterError.message}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${rosterRows.length} roster row(s) across: ${[...new Set(rosterRows.map((r) => r.cohort_id))].join(", ")}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
