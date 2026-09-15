import { describe, expect, it } from "vitest";
import { parseDueArgs, type DueParsed, type DueParseError } from "./dueParse.js";

// Monday, 2026-08-31, 10:00 Asia/Manila (02:00 UTC) — same reference instant
// `addTaskParse.test.ts` uses, so ISO expectations line up across both.
const REFERENCE = new Date("2026-08-31T02:00:00.000Z");

function ok(result: ReturnType<typeof parseDueArgs>): DueParsed {
  if (!result || "error" in result) {
    throw new Error("expected a parsed result, got: " + JSON.stringify(result));
  }
  return result;
}

function err(result: ReturnType<typeof parseDueArgs>): DueParseError {
  if (!result || !("error" in result)) {
    throw new Error("expected an error result, got: " + JSON.stringify(result));
  }
  return result;
}

describe("parseDueArgs", () => {
  it("bare ref and date, numeric ref", () => {
    const result = ok(parseDueArgs("t21 friday", REFERENCE));
    expect(result.ref).toBe("t21");
    expect(result.dueDate.isoDate).toBe("2026-09-04");
  });

  it("explicit optional 'by'", () => {
    const result = ok(parseDueArgs("t21 by next monday", REFERENCE));
    expect(result.ref).toBe("t21");
    expect(result.dueDate.isoDate).toBe("2026-09-07");
  });

  it("plain numeric ref (no t- prefix)", () => {
    const result = ok(parseDueArgs("23 sept 30", REFERENCE));
    expect(result.ref).toBe("23");
    expect(result.dueDate.isoDate).toBe("2026-09-30");
  });

  it("keyword ref, multi-word title fragment", () => {
    const result = ok(parseDueArgs("login bug friday", REFERENCE));
    expect(result.ref).toBe("login bug");
    expect(result.dueDate.isoDate).toBe("2026-09-04");
  });

  it("ISO date", () => {
    const result = ok(parseDueArgs("t21 2026-09-30", REFERENCE));
    expect(result.ref).toBe("t21");
    expect(result.dueDate.isoDate).toBe("2026-09-30");
  });

  it("trailing punctuation after a date is tolerated", () => {
    const result = ok(parseDueArgs("t21 friday.", REFERENCE));
    expect(result.ref).toBe("t21");
    expect(result.dueDate.isoDate).toBe("2026-09-04");
  });

  it("non-date trailing text is rejected by name, not partially matched", () => {
    const result = err(parseDueArgs("t21 friday please", REFERENCE));
    expect(result.error).toContain("friday please");
  });

  it("trailing garbage with no date anywhere is rejected by name", () => {
    const result = err(parseDueArgs("t21 banana", REFERENCE));
    expect(result.error).toContain("banana");
  });

  it("empty argument string yields no match", () => {
    expect(parseDueArgs("", REFERENCE)).toBeUndefined();
  });

  it("ref with no date yields no match", () => {
    expect(parseDueArgs("t21", REFERENCE)).toBeUndefined();
  });

  it("date with no ref yields no match", () => {
    expect(parseDueArgs("friday", REFERENCE)).toBeUndefined();
  });

  it("a date in the past is accepted", () => {
    const result = ok(parseDueArgs("t21 2020-01-15", REFERENCE));
    expect(result.ref).toBe("t21");
    expect(result.dueDate.isoDate).toBe("2020-01-15");
  });
});
