import { describe, expect, it } from "vitest";
import { InMemoryAlertThrottleStore } from "./inMemoryAlertThrottleStore.js";

describe("InMemoryAlertThrottleStore", () => {
  describe("claim", () => {
    it("claims a new key", async () => {
      const store = new InMemoryAlertThrottleStore();
      expect(await store.claim("digest:cohort-5:daily:2026-09-01")).toBe(true);
    });

    it("refuses a second claim of the same key", async () => {
      const store = new InMemoryAlertThrottleStore();
      expect(await store.claim("k")).toBe(true);
      expect(await store.claim("k")).toBe(false);
    });

    it("treats different keys independently", async () => {
      const store = new InMemoryAlertThrottleStore();
      expect(await store.claim("a")).toBe(true);
      expect(await store.claim("b")).toBe(true);
    });
  });

  describe("claimWithWindow", () => {
    it("claims a key never claimed before", async () => {
      const store = new InMemoryAlertThrottleStore();
      expect(await store.claimWithWindow("error:job:cohort-5", 1000)).toBe(true);
    });

    it("refuses a reclaim within the window", async () => {
      const store = new InMemoryAlertThrottleStore();
      expect(await store.claimWithWindow("k", 100_000)).toBe(true);
      expect(await store.claimWithWindow("k", 100_000)).toBe(false);
    });

    it("permits a reclaim once the window has elapsed", async () => {
      let now = 0;
      const store = new InMemoryAlertThrottleStore(() => new Date(now));
      expect(await store.claimWithWindow("k", 1000)).toBe(true);
      now = 500;
      expect(await store.claimWithWindow("k", 1000)).toBe(false);
      now = 1500;
      expect(await store.claimWithWindow("k", 1000)).toBe(true);
    });
  });
});
