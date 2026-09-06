import { describe, expect, it } from "vitest";
import { formatAuditTime, statusGlyph } from "./auditLogView.js";

describe("formatAuditTime", () => {
  it("renders an ISO timestamp as Asia/Manila h:mm:ss", () => {
    // 2026-08-31T02:00:00.000Z -> 10:00:00 Manila (UTC+8)
    expect(formatAuditTime("2026-08-31T02:00:00.000Z")).toBe("10:00:00 AM");
  });

  it("handles a time that crosses into PM in Manila", () => {
    // 2026-08-31T10:15:30.000Z -> 18:15:30 Manila -> 6:15:30 PM
    expect(formatAuditTime("2026-08-31T10:15:30.000Z")).toBe("06:15:30 PM");
  });
});

describe("statusGlyph", () => {
  it("renders a checkmark for ok", () => {
    expect(statusGlyph("ok")).toBe("✓");
  });

  it("renders an X for error", () => {
    expect(statusGlyph("error")).toBe("✗");
  });

  it("renders a middle dot for info", () => {
    expect(statusGlyph("info")).toBe("·");
  });
});
