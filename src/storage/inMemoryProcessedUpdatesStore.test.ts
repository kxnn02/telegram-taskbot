import { describe, expect, it } from "vitest";
import { InMemoryProcessedUpdatesStore } from "./inMemoryProcessedUpdatesStore.js";

describe("InMemoryProcessedUpdatesStore", () => {
  it("claims a new update id", async () => {
    const store = new InMemoryProcessedUpdatesStore();
    expect(await store.claim(1)).toBe(true);
  });

  it("refuses a second claim of the same update id", async () => {
    const store = new InMemoryProcessedUpdatesStore();
    expect(await store.claim(1)).toBe(true);
    expect(await store.claim(1)).toBe(false);
  });

  it("treats different update ids independently", async () => {
    const store = new InMemoryProcessedUpdatesStore();
    expect(await store.claim(1)).toBe(true);
    expect(await store.claim(2)).toBe(true);
  });
});
