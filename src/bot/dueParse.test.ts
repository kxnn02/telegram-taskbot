import { describe, expect, it } from "vitest";
import {
  parseDueArgs,
  isWholeArgDate,
  parseDueBatchItems,
  type DueParsed,
  type DueParseError,
} from "./dueParse.js";

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

  it("a multi-token, ref-less date still greedily takes the first token as ref (documented, handled by the caller, not here)", () => {
    // "next monday" is indistinguishable, at this layer, from a one-word
    // ref "next" plus a one-word date "monday" — see isWholeArgDate below,
    // which is what createBot.ts's /due handler uses to recover from this
    // once the ref has already failed to resolve against any real task.
    const result = ok(parseDueArgs("next monday", REFERENCE));
    expect(result.ref).toBe("next");
  });
});

describe("isWholeArgDate", () => {
  it("true for a multi-token phrase that is entirely a date", () => {
    expect(isWholeArgDate("next monday", REFERENCE)).toBe(true);
  });

  it("true for a single-token date", () => {
    expect(isWholeArgDate("friday", REFERENCE)).toBe(true);
  });

  it("false when a leading word isn't part of the date", () => {
    expect(isWholeArgDate("nonexistent friday", REFERENCE)).toBe(false);
  });

  it("false for a plain ref with no date at all", () => {
    expect(isWholeArgDate("t21", REFERENCE)).toBe(false);
  });

  it("tolerates trailing punctuation", () => {
    expect(isWholeArgDate("next monday!", REFERENCE)).toBe(true);
  });

  it("false for an empty string", () => {
    expect(isWholeArgDate("", REFERENCE)).toBe(false);
  });
});

describe("parseDueBatchItems (issue #223)", () => {
  it("a comma-separated list with a per-item date on each", () => {
    const items = parseDueBatchItems("t21 friday, t22 sept 30", REFERENCE);
    expect(items).toEqual([
      { label: "t21", ref: 21, dueDate: expect.objectContaining({ isoDate: "2026-09-04" }) },
      { label: "t22", ref: 22, dueDate: expect.objectContaining({ isoDate: "2026-09-30" }) },
    ]);
  });

  it("a newline-separated list with a per-item date on each", () => {
    const items = parseDueBatchItems("t21 friday\nt22 sept 30", REFERENCE);
    expect(items.map((i) => i.ref)).toEqual([21, 22]);
    expect(items.map((i) => i.dueDate?.isoDate)).toEqual(["2026-09-04", "2026-09-30"]);
  });

  it("a comma-separated ref list with one trailing shared date", () => {
    const items = parseDueBatchItems("t21, t22, t23 friday", REFERENCE);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.ref)).toEqual([21, 22, 23]);
    expect(items.every((i) => i.dueDate?.isoDate === "2026-09-04")).toBe(true);
  });

  it("a newline-separated ref list with one trailing shared date", () => {
    const items = parseDueBatchItems("t21\nt22\nt23 friday", REFERENCE);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.dueDate?.isoDate === "2026-09-04")).toBe(true);
  });

  it("a keyword ref works in a shared-date list alongside numeric refs", () => {
    const items = parseDueBatchItems("t21, login bug, t23 friday", REFERENCE);
    expect(items.map((i) => i.label)).toEqual(["t21", "login bug", "t23"]);
    expect(items.every((i) => i.dueDate?.isoDate === "2026-09-04")).toBe(true);
  });

  it("a mixed list where one segment fails to parse per-item falls back to the shared-date reading", () => {
    // Per-item parsing fails on "t22" alone (no date on that segment), so
    // the trailing-shared-date reading — one "friday" for the whole list —
    // wins instead, per #220's precedence (copied from /update's grammar).
    const items = parseDueBatchItems("t21, t22, t23 friday", REFERENCE);
    expect(items.map((i) => i.ref)).toEqual([21, 22, 23]);
  });

  it("when neither per-item nor shared-date parsing covers everything, each segment reports its own outcome", () => {
    const items = parseDueBatchItems("t21 friday, t22 banana", REFERENCE);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ label: "t21", ref: 21, dueDate: expect.objectContaining({ isoDate: "2026-09-04" }) });
    expect(items[1]!.dueDate).toBeUndefined();
    expect(items[1]!.error).toContain("banana");
  });

  it("a segment with a ref but no date at all is reported with a reason, not silently dropped", () => {
    const items = parseDueBatchItems("t21 banana, t22", REFERENCE);
    expect(items).toHaveLength(2);
    expect(items[1]!.label).toBe("t22");
    expect(items[1]!.dueDate).toBeUndefined();
    expect(items[1]!.error).toBeTruthy();
  });

  it("an empty argument string yields no items", () => {
    expect(parseDueBatchItems("", REFERENCE)).toEqual([]);
  });
});
