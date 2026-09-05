/**
 * Decides which `cohorts` rows `npm run seed:roster` should write
 * (`scripts/seedRosterAndCohorts.ts`).
 *
 * Extracted from that script once production went live, because the script's
 * original shape had become unsafe to run. It was written pre-cutover, when
 * the real cohort had no group chat yet, so it seeded the real cohort with
 * `group_chat_id: null` unconditionally — harmless then, but after the
 * cutover that column holds the live cohort's group id, and every digest and
 * standup is delivered to it. Re-running the script to set up the dry-run
 * cohort (ADR-0011) would have silently blanked it and stopped notifications
 * to the live group, with nothing failing anywhere to say so.
 *
 * The rule that follows is enforced here rather than in the script: the live
 * cohort's `group_chat_id` is preserved from whatever is already stored, and
 * the live cohort's row is only touched when explicitly asked for
 * (`scope: "all"`), so the dry-run setup path cannot reach production data
 * at all.
 *
 * This no longer plans any `roster` rows (ADR-0013): the roster is now
 * populated by the bot's auto-registration on first contact, not by this
 * script — see the ticket for #106. A stale `roster.local.json` full of
 * real usernames is no longer something this script can write to the live
 * cohort.
 */

export type SeedScope = "all" | "dry-run-only";

export interface SeedPlanInput {
  /** "dry-run-only" keeps every write inside the dry-run cohort. */
  scope: SeedScope;
  realCohortId: string;
  dryRunCohortId: string | undefined;
  dryRunGroupChatId: string | undefined;
  /** Current `group_chat_id` per cohort, so a seed never blanks a live value. */
  existingGroupChatIds: Record<string, string | null>;
}

export interface CohortRow {
  cohort_id: string;
  name: string;
  group_chat_id: string | null;
}

export interface SeedPlan {
  cohortRows: CohortRow[];
}

export function buildSeedPlan(input: SeedPlanInput): SeedPlan {
  const cohortRows: CohortRow[] = [];

  if (input.scope === "all") {
    cohortRows.push({
      cohort_id: input.realCohortId,
      name: "DevCon PH Cohort 5",
      // Never written from config: this is the live group's id, set at
      // cutover, and config has no better answer than what is already stored.
      group_chat_id: input.existingGroupChatIds[input.realCohortId] ?? null,
    });
  }

  const dryRunCohortId = input.dryRunCohortId;
  if (dryRunCohortId) {
    cohortRows.push({
      cohort_id: dryRunCohortId,
      name: "DevCon PH Cohort 5 (dry run)",
      group_chat_id:
        input.dryRunGroupChatId ?? input.existingGroupChatIds[dryRunCohortId] ?? null,
    });
  }

  return { cohortRows };
}
