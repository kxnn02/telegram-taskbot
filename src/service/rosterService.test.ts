import { describe, expect, it } from "vitest";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryRosterStore } from "../storage/inMemoryRosterStore.js";
import { RosterService } from "./rosterService.js";

const COHORT_A = "cohort-a";
const COHORT_B = "cohort-b";

function caller(username: string, cohortId = COHORT_A) {
  return { username, cohortId };
}

function makeService() {
  const rosterStore = new InMemoryRosterStore();
  const registrationStore = new InMemoryRegistrationStore();
  const service = new RosterService(rosterStore, registrationStore);
  return { service, rosterStore, registrationStore };
}

describe("RosterService.listMembers", () => {
  it("returns an empty list for a cohort with no roster entries", async () => {
    const { service } = makeService();
    const result = await service.listMembers(caller("alice"));
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("lists only members in the caller's cohort", async () => {
    const { service, rosterStore } = makeService();
    await rosterStore.upsert({ username: "alice", cohortId: COHORT_A }, "alice");
    await rosterStore.upsert({ username: "bob", cohortId: COHORT_B }, "bob");
    const result = await service.listMembers(caller("alice"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((m) => m.username)).toEqual(["alice"]);
    }
  });

  it("enriches a member with their Telegram id and registered-at when they've registered", async () => {
    const { service, rosterStore, registrationStore } = makeService();
    await rosterStore.upsert({ username: "alice", cohortId: COHORT_A }, "alice");
    await registrationStore.register(111, "alice");
    const result = await service.listMembers(caller("alice"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.telegramId).toBe(111);
      expect(result.value[0]!.registeredAt).toBeDefined();
    }
  });

  it("leaves telegramId/registeredAt undefined for a member who hasn't registered", async () => {
    const { service, rosterStore } = makeService();
    await rosterStore.upsert({ username: "alice", cohortId: COHORT_A }, "alice");
    const result = await service.listMembers(caller("alice"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.telegramId).toBeUndefined();
      expect(result.value[0]!.registeredAt).toBeUndefined();
    }
  });

  it("sorts members alphabetically by username", async () => {
    const { service, rosterStore } = makeService();
    await rosterStore.upsert({ username: "zed", cohortId: COHORT_A }, "zed");
    await rosterStore.upsert({ username: "alice", cohortId: COHORT_A }, "alice");
    const result = await service.listMembers(caller("alice"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((m) => m.username)).toEqual(["alice", "zed"]);
    }
  });
});

describe("RosterService.addMember", () => {
  it("adds a new member to the caller's cohort", async () => {
    const { service, rosterStore } = makeService();
    const result = await service.addMember(caller("alice"), "carol");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(await rosterStore.listAll()).toEqual([{ username: "carol", cohortId: COHORT_A }]);
  });

  it("normalizes the username (case, leading @)", async () => {
    const { service, rosterStore } = makeService();
    await service.addMember(caller("alice"), "@Carol");
    expect(await rosterStore.listAll()).toEqual([{ username: "carol", cohortId: COHORT_A }]);
  });

  it("rejects a blank username", async () => {
    const { service } = makeService();
    const result = await service.addMember(caller("alice"), "   ");
    expect(result.ok).toBe(false);
  });

  it("rejects adding a username already on the roster in the same cohort", async () => {
    const { service } = makeService();
    await service.addMember(caller("alice"), "carol");
    const result = await service.addMember(caller("alice"), "carol");
    expect(result).toEqual({ ok: false, error: "That member is already on the roster." });
  });

  it("allows the same username in a different cohort", async () => {
    const { service } = makeService();
    await service.addMember(caller("alice", COHORT_A), "carol");
    const result = await service.addMember(caller("bob", COHORT_B), "carol");
    expect(result.ok).toBe(true);
  });
});

describe("RosterService.renameMember", () => {
  it("renames an existing member", async () => {
    const { service, rosterStore } = makeService();
    await service.addMember(caller("alice"), "carol");
    const result = await service.renameMember(caller("alice"), "carol", "caroline");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(await rosterStore.listAll()).toEqual([{ username: "caroline", cohortId: COHORT_A }]);
  });

  it("fails when the member doesn't exist", async () => {
    const { service } = makeService();
    const result = await service.renameMember(caller("alice"), "nobody", "somebody");
    expect(result).toEqual({ ok: false, error: "Member not found." });
  });

  it("rejects a blank new username", async () => {
    const { service } = makeService();
    await service.addMember(caller("alice"), "carol");
    const result = await service.renameMember(caller("alice"), "carol", "  ");
    expect(result.ok).toBe(false);
  });

  it("rejects renaming onto a username already taken in the same cohort", async () => {
    const { service } = makeService();
    await service.addMember(caller("alice"), "carol");
    await service.addMember(caller("alice"), "dave");
    const result = await service.renameMember(caller("alice"), "carol", "dave");
    expect(result).toEqual({ ok: false, error: "That username is already on the roster." });
  });

  it("is a no-op success when renaming to the same username", async () => {
    const { service } = makeService();
    await service.addMember(caller("alice"), "carol");
    const result = await service.renameMember(caller("alice"), "carol", "carol");
    expect(result.ok).toBe(true);
  });
});

describe("RosterService.removeMember", () => {
  it("removes an existing member", async () => {
    const { service, rosterStore } = makeService();
    await service.addMember(caller("alice"), "carol");
    const result = await service.removeMember(caller("alice"), "carol");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(await rosterStore.listAll()).toEqual([]);
  });

  it("is a no-op success when the member doesn't exist", async () => {
    const { service } = makeService();
    const result = await service.removeMember(caller("alice"), "nobody");
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("does not remove a same-named member in a different cohort", async () => {
    const { service, rosterStore } = makeService();
    await service.addMember(caller("alice", COHORT_A), "carol");
    await service.addMember(caller("bob", COHORT_B), "carol");
    await service.removeMember(caller("alice", COHORT_A), "carol");
    expect(await rosterStore.listAll()).toEqual([{ username: "carol", cohortId: COHORT_B }]);
  });
});
