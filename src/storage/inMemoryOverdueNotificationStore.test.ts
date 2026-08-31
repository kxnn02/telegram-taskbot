import { describe, expect, it } from "vitest";
import { InMemoryOverdueNotificationStore } from "./inMemoryOverdueNotificationStore.js";

describe("InMemoryOverdueNotificationStore", () => {
  it("reports a task as not yet notified before it's marked", async () => {
    const store = new InMemoryOverdueNotificationStore();
    expect(await store.hasNotified("cohort-5", 1)).toBe(false);
  });

  it("reports a task as notified once marked", async () => {
    const store = new InMemoryOverdueNotificationStore();
    await store.markNotified("cohort-5", 1);
    expect(await store.hasNotified("cohort-5", 1)).toBe(true);
  });

  it("scopes notified state per cohort, not globally by task id", async () => {
    const store = new InMemoryOverdueNotificationStore();
    await store.markNotified("cohort-5", 1);
    expect(await store.hasNotified("cohort-4", 1)).toBe(false);
  });

  it("marking the same task notified twice doesn't throw", async () => {
    const store = new InMemoryOverdueNotificationStore();
    await store.markNotified("cohort-5", 7);
    await expect(store.markNotified("cohort-5", 7)).resolves.not.toThrow();
    expect(await store.hasNotified("cohort-5", 7)).toBe(true);
  });
});
