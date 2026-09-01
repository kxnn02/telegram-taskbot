import { describe, expect, it } from "vitest";
import { dailyDigestPeriodKey, weeklyDigestPeriodKey } from "./digestPeriodKey.js";

describe("dailyDigestPeriodKey", () => {
  it("returns the Asia/Manila calendar date", () => {
    // 2026-09-01T01:00:00Z is 2026-09-01T09:00:00+08:00 in Manila.
    expect(dailyDigestPeriodKey(new Date("2026-09-01T01:00:00Z"))).toBe("2026-09-01");
  });

  it("rolls over to the next Manila calendar day even while UTC is still on the previous day", () => {
    // 2026-08-31T17:00:00Z is 2026-09-01T01:00:00+08:00 in Manila.
    expect(dailyDigestPeriodKey(new Date("2026-08-31T17:00:00Z"))).toBe("2026-09-01");
  });
});

describe("weeklyDigestPeriodKey", () => {
  it("returns the Monday date of the current Manila week when called on a Monday", () => {
    // 2026-08-31 is a Monday.
    expect(weeklyDigestPeriodKey(new Date("2026-08-31T02:00:00Z"))).toBe("2026-08-31");
  });

  it("returns the same Monday date for any day later in that week", () => {
    // 2026-09-03 is the Thursday of the same week as 2026-08-31.
    expect(weeklyDigestPeriodKey(new Date("2026-09-03T02:00:00Z"))).toBe("2026-08-31");
  });
});
