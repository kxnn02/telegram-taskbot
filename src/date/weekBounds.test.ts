import { describe, expect, it } from "vitest";
import { formatWeekLabel, getWeekBounds } from "./weekBounds.js";

// Issue #107: Devie's `getWeekBounds(todayISO)` (`lib/standup.ts:64`) — Sun–Sat
// weeks, Asia/Manila-resolved. Built over this repo's Luxon-based date layer
// per the ticket's own instruction, rather than porting their `Intl` juggling.

describe("getWeekBounds", () => {
  it("a Sunday is the start of its own week", () => {
    // 2026-08-30 is a Sunday.
    const bounds = getWeekBounds("2026-08-30");
    expect(bounds.thisWeekStart).toBe("2026-08-30");
    expect(bounds.thisWeekEnd).toBe("2026-09-05");
    expect(bounds.lastWeekStart).toBe("2026-08-23");
    expect(bounds.lastWeekEnd).toBe("2026-08-29");
  });

  it("a Saturday is the end of its own week", () => {
    // 2026-09-05 is a Saturday, same week as the Sunday above.
    const bounds = getWeekBounds("2026-09-05");
    expect(bounds.thisWeekStart).toBe("2026-08-30");
    expect(bounds.thisWeekEnd).toBe("2026-09-05");
  });

  it("a midweek day resolves to the same bounds as its Sunday/Saturday", () => {
    // 2026-09-02 is a Wednesday in the same Sun-Sat week.
    const bounds = getWeekBounds("2026-09-02");
    expect(bounds.thisWeekStart).toBe("2026-08-30");
    expect(bounds.thisWeekEnd).toBe("2026-09-05");
    expect(bounds.lastWeekStart).toBe("2026-08-23");
    expect(bounds.lastWeekEnd).toBe("2026-08-29");
  });

  it("a week spanning a month boundary resolves correctly", () => {
    // 2026-04-29 (Wednesday) is in the Sun-Sat week Apr 26 - May 2.
    const bounds = getWeekBounds("2026-04-29");
    expect(bounds.thisWeekStart).toBe("2026-04-26");
    expect(bounds.thisWeekEnd).toBe("2026-05-02");
    expect(bounds.lastWeekStart).toBe("2026-04-19");
    expect(bounds.lastWeekEnd).toBe("2026-04-25");
  });
});

describe("formatWeekLabel", () => {
  it("renders an en dash between the two dates", () => {
    expect(formatWeekLabel("2026-04-27", "2026-05-03")).toBe("Apr 27 – May 3");
  });

  it("renders a same-month week", () => {
    expect(formatWeekLabel("2026-08-30", "2026-09-05")).toBe("Aug 30 – Sep 5");
  });
});
