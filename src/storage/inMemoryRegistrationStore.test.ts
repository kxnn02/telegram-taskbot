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

  it("finds no registered-at timestamp for a username that never registered", async () => {
    const store = new InMemoryRegistrationStore();
    expect(await store.findRegisteredAt("nobody")).toBeUndefined();
  });

  it("records a registered-at timestamp on register, readable by username", async () => {
    const store = new InMemoryRegistrationStore();
    const before = new Date().toISOString();
    await store.register(333, "carol");
    const registeredAt = await store.findRegisteredAt("carol");
    expect(registeredAt).toBeDefined();
    expect(registeredAt! >= before).toBe(true);
  });

  it("normalizes the username passed to findRegisteredAt (case, leading @)", async () => {
    const store = new InMemoryRegistrationStore();
    await store.register(333, "carol");
    expect(await store.findRegisteredAt("@Carol")).toBeDefined();
  });

  it("updates registered-at when the same Telegram id re-registers", async () => {
    const store = new InMemoryRegistrationStore();
    await store.register(444, "dave");
    const first = await store.findRegisteredAt("dave");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.register(444, "dave");
    const second = await store.findRegisteredAt("dave");
    expect(second! >= first!).toBe(true);
  });
});
