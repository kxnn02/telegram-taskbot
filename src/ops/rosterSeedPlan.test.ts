import { describe, expect, it } from "vitest";
import { buildSeedPlan, type SeedPlanInput } from "./rosterSeedPlan.js";

function input(overrides: Partial<SeedPlanInput> = {}): SeedPlanInput {
  return {
    scope: "dry-run-only",
    realCohortId: "cohort-5",
    dryRunCohortId: "cohort5-dryrun",
    dryRunGroupChatId: "-1009999",
    existingGroupChatIds: { "cohort-5": "-1001234", "cohort5-dryrun": null },
    rosterEntries: [
      { username: "real_higherup", role: "HigherUp", cohortId: "cohort-5" },
      { username: "real_intern", role: "Intern", cohortId: "cohort-5" },
      { username: "someone_else", role: "Intern", cohortId: "cohort-4" },
    ],
    dryRunHigherUpUsername: "real_higherup",
    dryRunInternUsername: "real_intern",
    ...overrides,
  };
}

describe("buildSeedPlan", () => {
  describe("dry-run-only scope (the default for the dry-run loop, ADR-0011)", () => {
    it("writes only the dry-run cohort, never the live one", () => {
      const plan = buildSeedPlan(input());
      expect(plan.cohortRows.map((r) => r.cohort_id)).toEqual(["cohort5-dryrun"]);
      expect(plan.rosterRows.every((r) => r.cohort_id === "cohort5-dryrun")).toBe(true);
    });

    it("seeds both dry-run roles from the configured real accounts", () => {
      const plan = buildSeedPlan(input());
      expect(plan.rosterRows).toEqual([
        { username: "real_higherup", role: "HigherUp", cohort_id: "cohort5-dryrun" },
        { username: "real_intern", role: "Intern", cohort_id: "cohort5-dryrun" },
      ]);
    });

    it("points the dry-run cohort at the dump group", () => {
      const plan = buildSeedPlan(input());
      expect(plan.cohortRows[0]?.group_chat_id).toBe("-1009999");
    });

    it("omits a dry-run role whose username is not configured", () => {
      const plan = buildSeedPlan(input({ dryRunInternUsername: undefined }));
      expect(plan.rosterRows.map((r) => r.username)).toEqual(["real_higherup"]);
    });

    it("plans nothing at all when no dry-run cohort is configured", () => {
      const plan = buildSeedPlan(input({ dryRunCohortId: undefined }));
      expect(plan.cohortRows).toEqual([]);
      expect(plan.rosterRows).toEqual([]);
    });
  });

  describe("all scope", () => {
    it("includes the live cohort and its roster entries", () => {
      const plan = buildSeedPlan(input({ scope: "all" }));
      expect(plan.cohortRows.map((r) => r.cohort_id)).toEqual(["cohort-5", "cohort5-dryrun"]);
      expect(plan.rosterRows.filter((r) => r.cohort_id === "cohort-5")).toEqual([
        { username: "real_higherup", role: "HigherUp", cohort_id: "cohort-5" },
        { username: "real_intern", role: "Intern", cohort_id: "cohort-5" },
      ]);
    });

    it("ignores roster entries belonging to another cohort", () => {
      const plan = buildSeedPlan(input({ scope: "all" }));
      expect(plan.rosterRows.some((r) => r.username === "someone_else")).toBe(false);
    });

    // The live-group regression this function exists to prevent: the real
    // cohort's group_chat_id was set at cutover and is what every digest is
    // delivered to. Re-seeding must never blank it.
    it("preserves the live cohort's existing group_chat_id instead of blanking it", () => {
      const plan = buildSeedPlan(input({ scope: "all" }));
      expect(plan.cohortRows.find((r) => r.cohort_id === "cohort-5")?.group_chat_id).toBe(
        "-1001234",
      );
    });

    it("leaves the live cohort's group_chat_id null when it has never been set", () => {
      const plan = buildSeedPlan(
        input({ scope: "all", existingGroupChatIds: { "cohort-5": null } }),
      );
      expect(plan.cohortRows.find((r) => r.cohort_id === "cohort-5")?.group_chat_id).toBeNull();
    });

    it("keeps the dry-run group_chat_id when DRYRUN_GROUP_CHAT_ID is unset", () => {
      const plan = buildSeedPlan(
        input({
          scope: "all",
          dryRunGroupChatId: undefined,
          existingGroupChatIds: { "cohort-5": "-1001234", "cohort5-dryrun": "-1008888" },
        }),
      );
      expect(plan.cohortRows.find((r) => r.cohort_id === "cohort5-dryrun")?.group_chat_id).toBe(
        "-1008888",
      );
    });
  });
});
