import { describe, expect, it } from "vitest";
import type { AuditLog } from "../domain/types.js";
import { formatAuditDate, groupAuditLogsByDay } from "./activityLogView.js";

/**
 * Pure view logic for the dedicated activity-log page (issue #105
 * sub-stage 5e), following this repo's `src/web/*.ts` view-builder
 * convention (unit-tested, no I/O) — mirrors `auditLogView.ts`/
 * `teamView.ts`. The settings page's inline list (`auditLogView.ts`,
 * shipped in 5c) is flat and capped at 50; the dedicated view groups a
 * paginated feed by calendar day, which `auditLogView.ts` never needed.
 */

function entry(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 1,
    cohortId: "cohort-5",
    action: "settings.config.save",
    status: "ok",
    message: "Settings saved",
    meta: {},
    createdAt: "2026-08-31T02:00:00.000Z",
    ...overrides,
  };
}

describe("formatAuditDate", () => {
  it("renders an ISO timestamp as an Asia/Manila calendar date", () => {
    // 2026-08-31T02:00:00.000Z -> Aug 31 in Manila (UTC+8)
    expect(formatAuditDate("2026-08-31T02:00:00.000Z")).toBe("Aug 31, 2026");
  });

  it("rolls over to the next Manila calendar day near midnight UTC", () => {
    // 2026-08-31T18:00:00.000Z -> Sep 1, 02:00 in Manila
    expect(formatAuditDate("2026-08-31T18:00:00.000Z")).toBe("Sep 1, 2026");
  });
});

describe("groupAuditLogsByDay", () => {
  it("returns an empty array for no entries", () => {
    expect(groupAuditLogsByDay([])).toEqual([]);
  });

  it("groups a single entry into one day", () => {
    const groups = groupAuditLogsByDay([entry({ id: 1, createdAt: "2026-08-31T02:00:00.000Z" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ dateLabel: "Aug 31, 2026" });
    expect(groups[0]?.entries).toHaveLength(1);
  });

  it("keeps same-day entries together, preserving their given order", () => {
    const groups = groupAuditLogsByDay([
      entry({ id: 2, createdAt: "2026-08-31T10:00:00.000Z" }),
      entry({ id: 1, createdAt: "2026-08-31T02:00:00.000Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual([2, 1]);
  });

  it("splits entries spanning multiple Manila calendar days into separate groups, newest first", () => {
    const groups = groupAuditLogsByDay([
      entry({ id: 3, createdAt: "2026-09-01T01:00:00.000Z" }), // Sep 1 Manila
      entry({ id: 2, createdAt: "2026-08-31T10:00:00.000Z" }), // Aug 31 Manila
      entry({ id: 1, createdAt: "2026-08-30T01:00:00.000Z" }), // Aug 30 Manila
    ]);
    expect(groups.map((g) => g.dateLabel)).toEqual(["Sep 1, 2026", "Aug 31, 2026", "Aug 30, 2026"]);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([[3], [2], [1]]);
  });

  it("does not merge two non-adjacent groups that share a date", () => {
    const groups = groupAuditLogsByDay([
      entry({ id: 3, createdAt: "2026-08-31T10:00:00.000Z" }),
      entry({ id: 2, createdAt: "2026-09-01T01:00:00.000Z" }),
      entry({ id: 1, createdAt: "2026-08-31T02:00:00.000Z" }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([[3], [2], [1]]);
  });
});
