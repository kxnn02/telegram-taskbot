import { describe, expect, it } from "vitest";
import { InMemoryRosterStore } from "./inMemoryRosterStore.js";

describe("InMemoryRosterStore", () => {
  it("upsert creates a new entry", async () => {
    const store = new InMemoryRosterStore();
    await store.upsert({ username: "alice", cohortId: "cohort-5" }, "bob");

    const all = await store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ username: "alice", cohortId: "cohort-5" });
  });

  it("upsert on an existing (cohortId, username) updates in place rather than duplicating", async () => {
    const store = new InMemoryRosterStore();
    await store.upsert({ username: "alice", cohortId: "cohort-5" }, "bob");
    await store.upsert({ username: "alice", cohortId: "cohort-5" }, "bob");

    const all = await store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ username: "alice", cohortId: "cohort-5" });
  });

  it("upsert records setBy", async () => {
    const store = new InMemoryRosterStore();
    await store.upsert({ username: "alice", cohortId: "cohort-5" }, "bob");

    expect(store.setByOf("cohort-5", "alice")).toBe("bob");
  });

  it("remove deletes an entry", async () => {
    const store = new InMemoryRosterStore();
    await store.upsert({ username: "alice", cohortId: "cohort-5" }, "bob");
    await store.remove("cohort-5", "alice");

    expect(await store.listAll()).toHaveLength(0);
  });

  it("remove on a missing entry is a no-op", async () => {
    const store = new InMemoryRosterStore();
    await expect(store.remove("cohort-5", "nobody")).resolves.toBeUndefined();
    expect(await store.listAll()).toHaveLength(0);
  });

  it("matches usernames case-insensitively and with a leading @ stripped, for both upsert and remove", async () => {
    const store = new InMemoryRosterStore();
    await store.upsert({ username: "@Alice", cohortId: "cohort-5" }, "bob");
    await store.upsert({ username: "ALICE", cohortId: "cohort-5" }, "carol");

    const all = await store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ username: "alice", cohortId: "cohort-5" });

    await store.remove("cohort-5", "@ALICE");
    expect(await store.listAll()).toHaveLength(0);
  });
});
