import { describe, expect, it } from "vitest";
import type { Caller } from "../domain/types.js";
import { InMemoryAuditLogStore } from "../storage/inMemoryAuditLogStore.js";
import { ActivityLogService } from "./activityLogService.js";

const COHORT = "cohort-5";
const OTHER_COHORT = "cohort-4";

function caller(username: string, cohortId = COHORT): Caller {
  return { username, cohortId };
}

const alice = caller("alice");
const erin = caller("erin", OTHER_COHORT);

function makeService() {
  const auditLogStore = new InMemoryAuditLogStore();
  const service = new ActivityLogService(auditLogStore);
  return { service, auditLogStore };
}

describe("ActivityLogService.listPage", () => {
  it("returns an empty page with no more rows when the cohort has no audit rows", async () => {
    const { service } = makeService();
    const result = await service.listPage(alice, { limit: 20 });
    expect(result).toEqual({ ok: true, value: { items: [], hasMore: false } });
  });

  it("returns rows newest first and reports hasMore when there are more than the page size", async () => {
    const { service, auditLogStore } = makeService();
    for (let i = 0; i < 5; i++) {
      await auditLogStore.insert(COHORT, { action: "settings.config.save", status: "ok", message: `save ${i}` });
    }
    const result = await service.listPage(alice, { limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(2);
    expect(result.value.items.map((r) => r.message)).toEqual(["save 4", "save 3"]);
    expect(result.value.hasMore).toBe(true);
  });

  it("pages forward with beforeId and reports hasMore: false on the last page", async () => {
    const { service, auditLogStore } = makeService();
    for (let i = 0; i < 3; i++) {
      await auditLogStore.insert(COHORT, { action: "settings.config.save", status: "ok", message: `save ${i}` });
    }
    const first = await service.listPage(alice, { limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const lastId = first.value.items[first.value.items.length - 1]?.id;
    const second = await service.listPage(alice, { limit: 2, beforeId: lastId });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items.map((r) => r.message)).toEqual(["save 0"]);
    expect(second.value.hasMore).toBe(false);
  });

  it("scopes to the caller's own cohort", async () => {
    const { service, auditLogStore } = makeService();
    await auditLogStore.insert(OTHER_COHORT, { action: "settings.config.save", status: "ok", message: "other" });
    const result = await service.listPage(alice, { limit: 20 });
    expect(result).toEqual({ ok: true, value: { items: [], hasMore: false } });

    const otherResult = await service.listPage(erin, { limit: 20 });
    expect(otherResult.ok).toBe(true);
    if (!otherResult.ok) return;
    expect(otherResult.value.items).toHaveLength(1);
  });
});
