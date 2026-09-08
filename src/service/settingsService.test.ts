import { describe, expect, it } from "vitest";
import type { Caller } from "../domain/types.js";
import { InMemoryAuditLogStore } from "../storage/inMemoryAuditLogStore.js";
import { InMemoryCohortStore } from "../storage/inMemoryCohortStore.js";
import { SettingsService } from "./settingsService.js";

const COHORT = "cohort-5";
const OTHER_COHORT = "cohort-4";

function caller(username: string, cohortId = COHORT): Caller {
  return { username, cohortId };
}

const alice = caller("alice");
const erin = caller("erin", OTHER_COHORT);

function makeService() {
  const cohortStore = new InMemoryCohortStore();
  const auditLogStore = new InMemoryAuditLogStore();
  const service = new SettingsService(cohortStore, auditLogStore);
  return { service, cohortStore, auditLogStore };
}

describe("SettingsService.getSettings", () => {
  it("returns undefined groupChatId and standupEnabled false for a cohort with none configured", async () => {
    const { service } = makeService();
    const result = await service.getSettings(alice);
    expect(result).toEqual({ ok: true, value: { groupChatId: undefined, standupEnabled: false } });
  });

  it("returns the cohort's configured groupChatId", async () => {
    const { service, cohortStore } = makeService();
    await cohortStore.setGroupChatId(COHORT, "-100123");
    const result = await service.getSettings(alice);
    expect(result).toEqual({ ok: true, value: { groupChatId: "-100123", standupEnabled: false } });
  });

  it("returns the cohort's configured standupEnabled", async () => {
    const { service, cohortStore } = makeService();
    await cohortStore.setStandupEnabled(COHORT, true);
    const result = await service.getSettings(alice);
    expect(result).toEqual({ ok: true, value: { groupChatId: undefined, standupEnabled: true } });
  });

  it("scopes to the caller's own cohort", async () => {
    const { service, cohortStore } = makeService();
    await cohortStore.setGroupChatId(OTHER_COHORT, "-100999");
    await cohortStore.setStandupEnabled(OTHER_COHORT, true);
    const result = await service.getSettings(alice);
    expect(result).toEqual({ ok: true, value: { groupChatId: undefined, standupEnabled: false } });
  });
});

describe("SettingsService.saveGroupChatId", () => {
  it("saves the new value and writes an ok audit row (Devie's settings.config.save)", async () => {
    const { service, cohortStore, auditLogStore } = makeService();
    const result = await service.saveGroupChatId(alice, "-100123");
    expect(result.ok).toBe(true);
    expect(await cohortStore.getGroupChatId(COHORT)).toBe("-100123");

    const rows = await auditLogStore.listRecent(COHORT, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cohortId: COHORT,
      action: "settings.config.save",
      status: "ok",
      message: "Settings saved",
    });
  });

  it("clears the value when given an empty string", async () => {
    const { service, cohortStore } = makeService();
    await cohortStore.setGroupChatId(COHORT, "-100123");
    await service.saveGroupChatId(alice, "");
    expect(await cohortStore.getGroupChatId(COHORT)).toBeUndefined();
  });

  it("scopes the write to the caller's own cohort", async () => {
    const { service, cohortStore } = makeService();
    await service.saveGroupChatId(erin, "-100999");
    expect(await cohortStore.getGroupChatId(OTHER_COHORT)).toBe("-100999");
    expect(await cohortStore.getGroupChatId(COHORT)).toBeUndefined();
  });

  it("writes an error audit row and returns fail when the store throws", async () => {
    const { auditLogStore } = makeService();
    const throwingCohortStore = {
      getGroupChatId: async () => undefined,
      setGroupChatId: async () => {
        throw new Error("db unavailable");
      },
      isStandupEnabled: async () => false,
      setStandupEnabled: async () => {},
    };
    const service = new SettingsService(throwingCohortStore, auditLogStore);
    const result = await service.saveGroupChatId(alice, "-100123");
    expect(result.ok).toBe(false);

    const rows = await auditLogStore.listRecent(COHORT, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "error", action: "settings.config.save" });
  });
});

describe("SettingsService.saveStandupEnabled", () => {
  it("saves true and writes an ok audit row", async () => {
    const { service, cohortStore, auditLogStore } = makeService();
    const result = await service.saveStandupEnabled(alice, true);
    expect(result.ok).toBe(true);
    expect(await cohortStore.isStandupEnabled(COHORT)).toBe(true);

    const rows = await auditLogStore.listRecent(COHORT, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cohortId: COHORT,
      action: "settings.standup.toggle",
      status: "ok",
      message: "Settings saved",
    });
  });

  it("saves false", async () => {
    const { service, cohortStore } = makeService();
    await cohortStore.setStandupEnabled(COHORT, true);
    await service.saveStandupEnabled(alice, false);
    expect(await cohortStore.isStandupEnabled(COHORT)).toBe(false);
  });

  it("scopes the write to the caller's own cohort", async () => {
    const { service, cohortStore } = makeService();
    await service.saveStandupEnabled(erin, true);
    expect(await cohortStore.isStandupEnabled(OTHER_COHORT)).toBe(true);
    expect(await cohortStore.isStandupEnabled(COHORT)).toBe(false);
  });

  it("writes an error audit row and returns fail when the store throws", async () => {
    const { auditLogStore } = makeService();
    const throwingCohortStore = {
      getGroupChatId: async () => undefined,
      setGroupChatId: async () => {},
      isStandupEnabled: async () => false,
      setStandupEnabled: async () => {
        throw new Error("db unavailable");
      },
    };
    const service = new SettingsService(throwingCohortStore, auditLogStore);
    const result = await service.saveStandupEnabled(alice, true);
    expect(result.ok).toBe(false);

    const rows = await auditLogStore.listRecent(COHORT, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "error", action: "settings.standup.toggle" });
  });
});

describe("SettingsService.listRecentActivity", () => {
  it("returns the cohort's recent audit rows, newest first", async () => {
    const { service } = makeService();
    await service.saveGroupChatId(alice, "-100111");
    await service.saveGroupChatId(alice, "-100222");
    const result = await service.listRecentActivity(alice, 50);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.message).toBe("Settings saved");
    }
  });

  it("scopes to the caller's own cohort", async () => {
    const { service } = makeService();
    await service.saveGroupChatId(erin, "-100999");
    const result = await service.listRecentActivity(alice, 50);
    expect(result).toEqual({ ok: true, value: [] });
  });
});
