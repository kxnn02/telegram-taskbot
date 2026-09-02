import { describe, expect, it } from "vitest";
import { Roster } from "./roster.js";

describe("Roster with the same username in more than one cohort", () => {
  // The dry-run cohort (ADR-0004) reuses the same two real Telegram
  // accounts under a second cohortId, so a username is no longer
  // guaranteed unique across the whole roster.
  function makeRoster() {
    return new Roster([
      { username: "kxnn02", role: "HigherUp", cohortId: "cohort-5" },
      { username: "chiaia_0702", role: "Intern", cohortId: "cohort-5" },
      { username: "kxnn02", role: "HigherUp", cohortId: "cohort5-dryrun" },
      { username: "chiaia_0702", role: "Intern", cohortId: "cohort5-dryrun" },
    ]);
  }

  it("all() returns every entry, not deduped by username", () => {
    expect(makeRoster().all()).toHaveLength(4);
  });

  it("find(username, cohortId) disambiguates by cohort", () => {
    const roster = makeRoster();
    expect(roster.find("kxnn02", "cohort-5")?.cohortId).toBe("cohort-5");
    expect(roster.find("kxnn02", "cohort5-dryrun")?.cohortId).toBe("cohort5-dryrun");
  });

  it("isIntern/isHigherUp still scope correctly by cohort", () => {
    const roster = makeRoster();
    expect(roster.isHigherUp("kxnn02", "cohort-5")).toBe(true);
    expect(roster.isHigherUp("kxnn02", "cohort5-dryrun")).toBe(true);
    expect(roster.isIntern("chiaia_0702", "cohort-5")).toBe(true);
    expect(roster.isIntern("chiaia_0702", "cohort5-dryrun")).toBe(true);
  });

  it("find(username) with no cohortId returns a deterministic (first-inserted) match", () => {
    const roster = makeRoster();
    expect(roster.find("kxnn02")?.cohortId).toBe("cohort-5");
  });
});

describe("Roster.replaceAll", () => {
  it("swaps the entries and lookups reflect the new contents", () => {
    const roster = new Roster([
      { username: "kxnn02", role: "HigherUp", cohortId: "cohort-5" },
      { username: "chiaia_0702", role: "Intern", cohortId: "cohort-5" },
    ]);

    roster.replaceAll([
      { username: "kxnn02", role: "Intern", cohortId: "cohort-5" },
      { username: "newperson", role: "HigherUp", cohortId: "cohort-5" },
    ]);

    expect(roster.all()).toHaveLength(2);
    expect(roster.roleOf("kxnn02")).toBe("Intern");
    expect(roster.find("newperson", "cohort-5")?.role).toBe("HigherUp");
    expect(roster.isHigherUp("newperson", "cohort-5")).toBe(true);
    expect(roster.isIntern("kxnn02", "cohort-5")).toBe(true);
    expect(roster.isMember("newperson", "cohort-5")).toBe(true);
  });

  it("a username present before replaceAll and absent afterward is no longer found", () => {
    const roster = new Roster([
      { username: "chiaia_0702", role: "Intern", cohortId: "cohort-5" },
    ]);

    roster.replaceAll([{ username: "kxnn02", role: "HigherUp", cohortId: "cohort-5" }]);

    expect(roster.find("chiaia_0702", "cohort-5")).toBeUndefined();
    expect(roster.isMember("chiaia_0702", "cohort-5")).toBe(false);
    expect(roster.roleOf("chiaia_0702")).toBeUndefined();
  });
});
