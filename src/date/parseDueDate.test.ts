import { describe, expect, it } from "vitest";
import { comingFriday, parseDueDate } from "./parseDueDate.js";

// Monday, 2026-08-31, 10:00 Asia/Manila (02:00 UTC), used as a fixed
// reference "now" for every phrase below so results are deterministic.
const REFERENCE = new Date("2026-08-31T02:00:00.000Z");

describe("parseDueDate", () => {
  it("resolves 'next Friday' relative to Asia/Manila", () => {
    const result = parseDueDate("next Friday", REFERENCE);
    expect(result?.isoDate).toBe("2026-09-11");
  });

  it("resolves 'in 3 days' relative to Asia/Manila", () => {
    const result = parseDueDate("in 3 days", REFERENCE);
    expect(result?.isoDate).toBe("2026-09-03");
  });

  it("resolves an explicit 'Sept 5'", () => {
    const result = parseDueDate("Sept 5", REFERENCE);
    expect(result?.isoDate).toBe("2026-09-05");
  });

  it("resolves 'tomorrow'", () => {
    const result = parseDueDate("tomorrow", REFERENCE);
    expect(result?.isoDate).toBe("2026-09-01");
  });

  it("produces a human-friendly echo string", () => {
    const result = parseDueDate("Sept 5", REFERENCE);
    expect(result?.friendly).toContain("September 5, 2026");
  });

  it("returns undefined for text with no discernible date", () => {
    const result = parseDueDate("thanks for the update", REFERENCE);
    expect(result).toBeUndefined();
  });

  it("reports the matched span (index/text) alongside the resolved date (issue #30)", () => {
    const result = parseDueDate("fix the login by Friday", REFERENCE);
    expect(result?.text).toBe("Friday");
    expect(result?.index).toBe("fix the login by ".length);
  });
});

describe("comingFriday", () => {
  it("resolves to this week's Friday when 'now' is a Monday", () => {
    // REFERENCE is Monday, 2026-08-31.
    expect(comingFriday(REFERENCE).isoDate).toBe("2026-09-04");
  });

  it("resolves to the same day when 'now' is already a Friday", () => {
    const friday = new Date("2026-09-04T02:00:00.000Z"); // Friday, Manila
    expect(comingFriday(friday).isoDate).toBe("2026-09-04");
  });

  it("resolves to the coming Friday when 'now' is a Saturday", () => {
    const saturday = new Date("2026-09-05T02:00:00.000Z");
    expect(comingFriday(saturday).isoDate).toBe("2026-09-11");
  });

  it("resolves to the coming Friday when 'now' is a Sunday", () => {
    const sunday = new Date("2026-09-06T02:00:00.000Z");
    expect(comingFriday(sunday).isoDate).toBe("2026-09-11");
  });
});
