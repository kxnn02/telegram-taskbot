import { describe, expect, it } from "vitest";
import { parseDueDate } from "./parseDueDate.js";

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
});
