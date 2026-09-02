import { describe, expect, it } from "vitest";
import type { RosterStorePort } from "../storage/rosterStorePort.js";
import type { RosterEntry } from "../domain/types.js";
import { loadRosterFromStore } from "./roster.js";

function fakeStore(entries: RosterEntry[]): RosterStorePort {
  return {
    listAll: async () => entries,
    upsert: async () => {
      throw new Error("not implemented in fakeStore");
    },
    remove: async () => {
      throw new Error("not implemented in fakeStore");
    },
  };
}

describe("loadRosterFromStore", () => {
  it("builds a Roster from every row the store returns, across cohorts", async () => {
    const store = fakeStore([
      { username: "kxnn02", role: "HigherUp", cohortId: "cohort-5" },
      { username: "chiaia_0702", role: "Intern", cohortId: "cohort-5" },
      { username: "kxnn02", role: "HigherUp", cohortId: "cohort5-dryrun" },
      { username: "chiaia_0702", role: "Intern", cohortId: "cohort5-dryrun" },
    ]);

    const roster = await loadRosterFromStore(store);

    expect(roster.isHigherUp("kxnn02", "cohort-5")).toBe(true);
    expect(roster.isIntern("chiaia_0702", "cohort-5")).toBe(true);
    expect(roster.isHigherUp("kxnn02", "cohort5-dryrun")).toBe(true);
    expect(roster.all()).toHaveLength(4);
  });
});
