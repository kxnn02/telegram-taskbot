import { describe, expect, it } from "vitest";
import { InMemoryRegistrationStore } from "./inMemoryRegistrationStore.js";

describe("InMemoryRegistrationStore", () => {
  it("finds no username before /start has been run", async () => {
    const store = new InMemoryRegistrationStore();
    expect(await store.findUsername(111)).toBeUndefined();
  });

  it("links a Telegram user id to a username on register", async () => {
    const store = new InMemoryRegistrationStore();
    await store.register(111, "alice");
    expect(await store.findUsername(111)).toBe("alice");
  });

  it("normalizes usernames (case, leading @) on register and lookup", async () => {
    const store = new InMemoryRegistrationStore();
    await store.register(111, "@Alice");
    expect(await store.findUsername(111)).toBe("alice");
    expect(await store.findTelegramId("ALICE")).toBe(111);
  });

  it("re-registering the same Telegram id updates the linked username", async () => {
    const store = new InMemoryRegistrationStore();
    await store.register(111, "alice");
    await store.register(111, "alice2");
    expect(await store.findUsername(111)).toBe("alice2");
  });

  it("finds no Telegram id for a username that never registered", async () => {
    const store = new InMemoryRegistrationStore();
    expect(await store.findTelegramId("nobody")).toBeUndefined();
  });

  it("finds a Telegram id by username after registration", async () => {
    const store = new InMemoryRegistrationStore();
    await store.register(222, "bob");
    expect(await store.findTelegramId("bob")).toBe(222);
  });
});
