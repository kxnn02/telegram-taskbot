import { describe, expect, it } from "vitest";
import { standupSkipReason } from "./standupCalendar.js";

// Issue #227 (spec #226): the standup push skips weekends and Philippine
// holidays. All dates below are read as Asia/Manila calendar days.

describe("standupSkipReason", () => {
  it("sends on an ordinary Manila weekday", () => {
    // 2026-09-15 is a Tuesday, Asia/Manila.
    const now = new Date("2026-09-15T04:00:00.000Z"); // noon Manila
    expect(standupSkipReason(now)).toBeUndefined();
  });

  it("skips as weekend on a Manila Saturday", () => {
    // 2026-09-19 is a Saturday, Asia/Manila.
    const now = new Date("2026-09-19T04:00:00.000Z");
    expect(standupSkipReason(now)).toBe("weekend");
  });

  it("skips as weekend on a Manila Sunday", () => {
    // 2026-09-20 is a Sunday, Asia/Manila.
    const now = new Date("2026-09-20T04:00:00.000Z");
    expect(standupSkipReason(now)).toBe("weekend");
  });

  it("skips as holiday on an encoded regular holiday that falls on a weekday", () => {
    // 2026-06-12 (Independence Day) is a Friday, Asia/Manila.
    const now = new Date("2026-06-12T04:00:00.000Z");
    expect(standupSkipReason(now)).toBe("holiday");
  });

  it("skips as holiday on an encoded special (non-working) day that falls on a weekday", () => {
    // 2026-08-21 (Ninoy Aquino Day) is a Friday, Asia/Manila.
    const now = new Date("2026-08-21T04:00:00.000Z");
    expect(standupSkipReason(now)).toBe("holiday");
  });

  it("reports weekend, not holiday, when a holiday falls on a weekend", () => {
    // 2026-11-01 (All Saints' Day, a special non-working day) is a Sunday
    // in Asia/Manila, so the weekend check wins over the holiday check.
    const now = new Date("2026-11-01T04:00:00.000Z");
    expect(standupSkipReason(now)).toBe("weekend");
  });

  it("sends (fail-open) for a Date in a year the holiday list does not cover", () => {
    // 2030-01-01 would be New Year's Day, but 2030 is not encoded.
    const now = new Date("2030-01-01T04:00:00.000Z"); // noon Manila
    expect(standupSkipReason(now)).toBeUndefined();
  });

  it("timezone regression: late Sunday UTC that is already early Monday in Manila sends", () => {
    // 2026-09-20 23:05 UTC is 2026-09-21 07:05 Manila (Monday, not a
    // holiday) — a UTC-based check would see Sunday and wrongly skip.
    const now = new Date("2026-09-20T23:05:00.000Z");
    expect(standupSkipReason(now)).toBeUndefined();
  });

  it("timezone regression: late Friday UTC that is already Saturday in Manila skips as weekend", () => {
    // 2026-09-18 23:05 UTC is 2026-09-19 07:05 Manila (Saturday) — a
    // UTC-based check would see Friday and wrongly send.
    const now = new Date("2026-09-18T23:05:00.000Z");
    expect(standupSkipReason(now)).toBe("weekend");
  });
});
