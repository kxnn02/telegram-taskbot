import { describe, expect, it } from "vitest";
import { Roster } from "../domain/roster.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryRosterStore } from "../storage/inMemoryRosterStore.js";
import { resolveCaller } from "./callerResolution.js";

const TELEGRAM_ID = 42;

describe("resolveCaller — auto-registration (ADR-0013)", () => {
  it("registers an unknown sender on first message, scoped to the active cohort", async () => {
    const registrations = new InMemoryRegistrationStore();
    const rosterStore = new InMemoryRosterStore();
    const roster = new Roster([]);

    const result = await resolveCaller(
      { id: TELEGRAM_ID, username: "newperson" },
      registrations,
      rosterStore,
      roster,
      "cohort-5",
    );

    expect(result).toEqual({
      status: "ok",
      caller: { username: "newperson", cohortId: "cohort-5" },
    });
    expect(await registrations.findUsername(TELEGRAM_ID)).toBe("newperson");
    expect(roster.isMember("newperson", "cohort-5")).toBe(true);
    expect((await rosterStore.listAll()).map((e) => e.username)).toEqual(["newperson"]);
  });

  it("a second message from the same sender updates their link rather than inserting again", async () => {
    const registrations = new InMemoryRegistrationStore();
    const rosterStore = new InMemoryRosterStore();
    const roster = new Roster([]);

    await resolveCaller({ id: TELEGRAM_ID, username: "alice" }, registrations, rosterStore, roster, "cohort-5");
    // Telegram usernames can change; the same telegram_user_id sending again
    // must update the same registration row, not create a second one.
    const result = await resolveCaller(
      { id: TELEGRAM_ID, username: "alice_new_handle" },
      registrations,
      rosterStore,
      roster,
      "cohort-5",
    );

    expect(result).toEqual({
      status: "ok",
      caller: { username: "alice_new_handle", cohortId: "cohort-5" },
    });
    // register() is keyed on telegram_user_id, so the second call updates
    // the same row in place — findUsername reflects the latest contact.
    expect(await registrations.findUsername(TELEGRAM_ID)).toBe("alice_new_handle");
  });

  it("a repeated message with an unchanged username never grows the roster", async () => {
    const registrations = new InMemoryRegistrationStore();
    const rosterStore = new InMemoryRosterStore();
    const roster = new Roster([]);

    await resolveCaller({ id: TELEGRAM_ID, username: "bob" }, registrations, rosterStore, roster, "cohort-5");
    await resolveCaller({ id: TELEGRAM_ID, username: "bob" }, registrations, rosterStore, roster, "cohort-5");
    await resolveCaller({ id: TELEGRAM_ID, username: "bob" }, registrations, rosterStore, roster, "cohort-5");

    expect((await rosterStore.listAll()).filter((e) => e.username === "bob")).toHaveLength(1);
  });

  it("registration is scoped to the deployment's active cohort — the same sender in a different cohort's deployment is a separate roster row", async () => {
    const registrations = new InMemoryRegistrationStore();
    const rosterStore = new InMemoryRosterStore();
    const roster = new Roster([]);

    await resolveCaller(
      { id: TELEGRAM_ID, username: "kxnn02" },
      registrations,
      rosterStore,
      roster,
      "cohort-5",
    );
    const dryRunResult = await resolveCaller(
      { id: TELEGRAM_ID, username: "kxnn02" },
      registrations,
      rosterStore,
      roster,
      "cohort5-dryrun",
    );

    expect(dryRunResult).toEqual({
      status: "ok",
      caller: { username: "kxnn02", cohortId: "cohort5-dryrun" },
    });
    expect(roster.isMember("kxnn02", "cohort-5")).toBe(true);
    expect(roster.isMember("kxnn02", "cohort5-dryrun")).toBe(true);
    const all = await rosterStore.listAll();
    expect(all.filter((e) => e.username === "kxnn02").map((e) => e.cohortId).sort()).toEqual([
      "cohort-5",
      "cohort5-dryrun",
    ]);
  });

  it("returns no_username for a Telegram account with no username set, without registering anything", async () => {
    const registrations = new InMemoryRegistrationStore();
    const rosterStore = new InMemoryRosterStore();
    const roster = new Roster([]);

    const result = await resolveCaller(
      { id: TELEGRAM_ID, username: undefined },
      registrations,
      rosterStore,
      roster,
      "cohort-5",
    );

    expect(result).toEqual({ status: "no_username" });
    expect(await registrations.findUsername(TELEGRAM_ID)).toBeUndefined();
    expect(await rosterStore.listAll()).toEqual([]);
  });

  it("returns a lowercase caller.username even when the sender's Telegram username is mixed-case (issue #54/F4)", async () => {
    const registrations = new InMemoryRegistrationStore();
    const rosterStore = new InMemoryRosterStore();
    const roster = new Roster([]);

    const result = await resolveCaller(
      { id: TELEGRAM_ID, username: "Alice" },
      registrations,
      rosterStore,
      roster,
      "cohort-5",
    );

    expect(result).toEqual({
      status: "ok",
      caller: { username: "alice", cohortId: "cohort-5" },
    });
  });

  it("does not re-write the roster row when the sender is already a known member", async () => {
    const registrations = new InMemoryRegistrationStore();
    const rosterStore = new InMemoryRosterStore();
    const roster = new Roster([{ username: "carla", cohortId: "cohort-5" }]);

    await resolveCaller({ id: TELEGRAM_ID, username: "carla" }, registrations, rosterStore, roster, "cohort-5");

    // Already a member per the in-process roster — resolveCaller must not
    // have needed to touch the roster store at all.
    expect(await rosterStore.listAll()).toEqual([]);
  });
});
