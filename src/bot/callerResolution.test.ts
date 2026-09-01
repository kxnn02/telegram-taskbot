import { describe, expect, it } from "vitest";
import { Roster } from "../domain/roster.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { resolveCaller } from "./callerResolution.js";

const TELEGRAM_ID = 42;

// The exact shape of the bug the gate found: the dry-run cohort (ADR-0004)
// reuses the same real Telegram accounts under a second cohortId, so
// "kxnn02" exists as HigherUp under both cohort-5 and cohort5-dryrun.
function ambiguousRoster() {
  return new Roster([
    { username: "kxnn02", role: "HigherUp", cohortId: "cohort-5" },
    { username: "kxnn02", role: "HigherUp", cohortId: "cohort5-dryrun" },
  ]);
}

describe("resolveCaller — cohort binding", () => {
  it("resolves against the deployment's bound cohortId, not whichever cohort happens to be first in roster order", async () => {
    const registrations = new InMemoryRegistrationStore();
    await registrations.register(TELEGRAM_ID, "kxnn02");
    const roster = ambiguousRoster();

    const boundToDryRun = await resolveCaller(TELEGRAM_ID, registrations, roster, "cohort5-dryrun");
    expect(boundToDryRun).toEqual({
      status: "ok",
      caller: { username: "kxnn02", role: "HigherUp", cohortId: "cohort5-dryrun" },
    });

    const boundToReal = await resolveCaller(TELEGRAM_ID, registrations, roster, "cohort-5");
    expect(boundToReal).toEqual({
      status: "ok",
      caller: { username: "kxnn02", role: "HigherUp", cohortId: "cohort-5" },
    });
  });

  it("reports not_on_roster when the username exists, but not under the bound cohort", async () => {
    const registrations = new InMemoryRegistrationStore();
    await registrations.register(TELEGRAM_ID, "kxnn02");
    // Only registered under cohort-5, not some third cohort this deployment
    // might be bound to.
    const roster = new Roster([{ username: "kxnn02", role: "HigherUp", cohortId: "cohort-5" }]);

    const result = await resolveCaller(TELEGRAM_ID, registrations, roster, "some-other-cohort");
    expect(result).toEqual({ status: "not_on_roster" });
  });

  it("still reports not_started when the user never ran /start", async () => {
    const registrations = new InMemoryRegistrationStore();
    const result = await resolveCaller(TELEGRAM_ID, registrations, ambiguousRoster(), "cohort-5");
    expect(result).toEqual({ status: "not_started" });
  });

  it("returns a lowercase caller.username even when the roster entry's casing is mixed-case (issue #54/F4)", async () => {
    const registrations = new InMemoryRegistrationStore();
    await registrations.register(TELEGRAM_ID, "alice");
    const roster = new Roster([{ username: "Alice", role: "Intern", cohortId: "cohort-5" }]);

    const result = await resolveCaller(TELEGRAM_ID, registrations, roster, "cohort-5");
    expect(result).toEqual({
      status: "ok",
      caller: { username: "alice", role: "Intern", cohortId: "cohort-5" },
    });
  });
});
