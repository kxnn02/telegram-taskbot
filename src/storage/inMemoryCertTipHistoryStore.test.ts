import { describe, expect, it } from "vitest";
import { InMemoryCertTipHistoryStore } from "./inMemoryCertTipHistoryStore.js";

describe("InMemoryCertTipHistoryStore", () => {
  it("returns null for a cohort with no history yet", async () => {
    const store = new InMemoryCertTipHistoryStore();
    expect(await store.getLastTipId("cohort-a")).toBeNull();
  });

  it("returns the id last set for a cohort", async () => {
    const store = new InMemoryCertTipHistoryStore();
    await store.setLastTipId("cohort-a", 7);
    expect(await store.getLastTipId("cohort-a")).toBe(7);
  });

  it("scopes history independently per cohort id", async () => {
    const store = new InMemoryCertTipHistoryStore();
    await store.setLastTipId("cohort-a", 7);
    expect(await store.getLastTipId("cohort-b")).toBeNull();
  });

  it("overwrites the previous value on a second call for the same cohort", async () => {
    const store = new InMemoryCertTipHistoryStore();
    await store.setLastTipId("cohort-a", 7);
    await store.setLastTipId("cohort-a", 12);
    expect(await store.getLastTipId("cohort-a")).toBe(12);
  });
});
