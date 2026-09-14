import { describe, expect, it } from "vitest";
import { renderDueDate } from "./renderDueDate.js";

// Issue #203 (spec #201, "A single due-date renderer is the root of the
// change"): the only place permitted to turn a due date into display text.
// Every case in the output table, proved directly against a fixed `now`, in
// both forms.

// 2026-09-15 is a Tuesday, Asia/Manila.
const NOW = new Date("2026-09-15T04:00:00.000Z"); // 2026-09-15 12:00 Manila

describe("renderDueDate", () => {
  it("overdue by 2+ days", () => {
    expect(renderDueDate("2026-09-12", NOW, true, "long")).toBe("3 days ago");
    expect(renderDueDate("2026-09-12", NOW, true, "short")).toBe("3 days ago");
  });

  it("overdue by exactly 1 day", () => {
    expect(renderDueDate("2026-09-14", NOW, true, "long")).toBe("yesterday");
    expect(renderDueDate("2026-09-14", NOW, true, "short")).toBe("yesterday");
  });

  it("due today", () => {
    expect(renderDueDate("2026-09-15", NOW, false, "long")).toBe("today");
    expect(renderDueDate("2026-09-15", NOW, false, "short")).toBe("today");
  });

  it("due tomorrow", () => {
    expect(renderDueDate("2026-09-16", NOW, false, "long")).toBe("tomorrow");
    expect(renderDueDate("2026-09-16", NOW, false, "short")).toBe("tomorrow");
  });

  it("upcoming, current year", () => {
    // 2026-09-18 is a Friday.
    expect(renderDueDate("2026-09-18", NOW, false, "long")).toBe("Friday, September 18");
    expect(renderDueDate("2026-09-18", NOW, false, "short")).toBe("Fri, Sep 18");
  });

  it("upcoming, other year", () => {
    // 2027-01-02 is a Saturday.
    expect(renderDueDate("2027-01-02", NOW, false, "long")).toBe(
      "Saturday, January 2, 2027",
    );
    expect(renderDueDate("2027-01-02", NOW, false, "short")).toBe("Sat, Jan 2, 2027");
  });

  it("no due date", () => {
    expect(renderDueDate(undefined, NOW, false, "long")).toBe("");
    expect(renderDueDate(undefined, NOW, false, "short")).toBe("");
    expect(renderDueDate(null, NOW, false, "long")).toBe("");
  });

  it("boundary: now at the very start of the day, Asia/Manila", () => {
    // 2026-09-15T00:00:00 Manila == 2026-09-14T16:00:00Z.
    const startOfDay = new Date("2026-09-14T16:00:00.000Z");
    expect(renderDueDate("2026-09-15", startOfDay, false, "long")).toBe("today");
  });

  it("boundary: now at the very end of the day, Asia/Manila", () => {
    // 2026-09-15T23:59:59 Manila == 2026-09-15T15:59:59Z.
    const endOfDay = new Date("2026-09-15T15:59:59.000Z");
    expect(renderDueDate("2026-09-15", endOfDay, false, "long")).toBe("today");
  });

  it("boundary: a due date crossing a year boundary relative to now", () => {
    // now is New Year's Eve; due date is two days later, into the new year.
    const dec31 = new Date("2026-12-31T04:00:00.000Z"); // 2026-12-31 12:00 Manila
    // 2027-01-02 is a Saturday.
    expect(renderDueDate("2027-01-02", dec31, false, "long")).toBe(
      "Saturday, January 2, 2027",
    );
    expect(renderDueDate("2027-01-02", dec31, false, "short")).toBe(
      "Sat, Jan 2, 2027",
    );
  });
});
