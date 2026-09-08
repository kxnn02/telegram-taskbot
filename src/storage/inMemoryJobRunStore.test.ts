import { describe, expect, it } from "vitest";
import { InMemoryJobRunStore } from "./inMemoryJobRunStore.js";

describe("InMemoryJobRunStore", () => {
  it("records a run and exposes it for assertions in tests", async () => {
    const store = new InMemoryJobRunStore();
    await store.record("keep-alive", "success", null);
    expect(store.runs).toEqual([{ jobName: "keep-alive", status: "success", detail: null }]);
  });

  it("records multiple runs in call order", async () => {
    const store = new InMemoryJobRunStore();
    await store.record("keep-alive", "success", null);
    await store.record("weekly-backup", "error", "GitHub backup commit failed (500)");
    expect(store.runs).toEqual([
      { jobName: "keep-alive", status: "success", detail: null },
      { jobName: "weekly-backup", status: "error", detail: "GitHub backup commit failed (500)" },
    ]);
  });
});
