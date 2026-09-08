import { describe, expect, it } from "vitest";
import { InMemoryCohortStore } from "./inMemoryCohortStore.js";

describe("InMemoryCohortStore", () => {
  it("returns undefined for a cohort with no group chat id seeded", async () => {
    const store = new InMemoryCohortStore();
    expect(await store.getGroupChatId("cohort-5")).toBeUndefined();
  });

  it("returns a seeded group chat id", async () => {
    const store = new InMemoryCohortStore({ "cohort-5": "-100123" });
    expect(await store.getGroupChatId("cohort-5")).toBe("-100123");
  });

  it("sets and then reads back a group chat id", async () => {
    const store = new InMemoryCohortStore();
    await store.setGroupChatId("cohort-5", "-100999");
    expect(await store.getGroupChatId("cohort-5")).toBe("-100999");
  });

  it("clears a group chat id when set to an empty string", async () => {
    const store = new InMemoryCohortStore({ "cohort-5": "-100123" });
    await store.setGroupChatId("cohort-5", "");
    expect(await store.getGroupChatId("cohort-5")).toBeUndefined();
  });

  it("defaults isStandupEnabled to false for a cohort with no row at all", async () => {
    const store = new InMemoryCohortStore();
    expect(await store.isStandupEnabled("cohort-5")).toBe(false);
  });

  it("turns the standup on and reads it back", async () => {
    const store = new InMemoryCohortStore();
    await store.setStandupEnabled("cohort-5", true);
    expect(await store.isStandupEnabled("cohort-5")).toBe(true);
  });

  it("turns the standup back off", async () => {
    const store = new InMemoryCohortStore();
    await store.setStandupEnabled("cohort-5", true);
    await store.setStandupEnabled("cohort-5", false);
    expect(await store.isStandupEnabled("cohort-5")).toBe(false);
  });

  it("keeps the group chat id and the standup flag independent per cohort", async () => {
    const store = new InMemoryCohortStore({ "cohort-5": "-100123" });
    await store.setStandupEnabled("cohort-5", true);
    expect(await store.getGroupChatId("cohort-5")).toBe("-100123");
    expect(await store.isStandupEnabled("cohort-dryrun")).toBe(false);
  });
});
