import { describe, expect, it } from "vitest";
import { SessionStore } from "./sessionStore.js";
import type { Caller } from "../domain/types.js";

const carla: Caller = { username: "carla", role: "HigherUp", cohortId: "cohort-5" };

describe("SessionStore", () => {
  it("returns undefined for a token that was never created", () => {
    const store = new SessionStore();
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("returns the caller for a token it issued", () => {
    const store = new SessionStore();
    const token = store.create(carla);
    expect(store.get(token)).toEqual(carla);
  });

  it("issues distinct tokens for distinct sessions", () => {
    const store = new SessionStore();
    const t1 = store.create(carla);
    const t2 = store.create(carla);
    expect(t1).not.toBe(t2);
  });

  it("no longer returns the caller after destroy", () => {
    const store = new SessionStore();
    const token = store.create(carla);
    store.destroy(token);
    expect(store.get(token)).toBeUndefined();
  });

  it("expires a session after the configured TTL", () => {
    let now = 0;
    const store = new SessionStore({ ttlMs: 1000, clock: () => now });
    const token = store.create(carla);
    now = 1500;
    expect(store.get(token)).toBeUndefined();
  });

  it("keeps a session alive within the TTL window", () => {
    let now = 0;
    const store = new SessionStore({ ttlMs: 1000, clock: () => now });
    const token = store.create(carla);
    now = 500;
    expect(store.get(token)).toEqual(carla);
  });
});
