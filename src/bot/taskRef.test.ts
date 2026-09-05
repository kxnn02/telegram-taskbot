import { describe, expect, it } from "vitest";
import { formatTaskRef, parseTaskRef } from "./taskRef.js";

describe("parseTaskRef (issue #31's shared task-ref parser)", () => {
  it("accepts a bare number", () => {
    expect(parseTaskRef("23")).toBe(23);
  });

  it("accepts a lowercase t-prefixed ref", () => {
    expect(parseTaskRef("t23")).toBe(23);
  });

  it("accepts an uppercase T-prefixed ref", () => {
    expect(parseTaskRef("T23")).toBe(23);
  });

  it("rejects t0 — ids are 1-indexed", () => {
    expect(parseTaskRef("t0")).toBeUndefined();
  });

  it("rejects a bare 't' with no digits", () => {
    expect(parseTaskRef("t")).toBeUndefined();
  });

  it("rejects trailing garbage like 23abc", () => {
    expect(parseTaskRef("23abc")).toBeUndefined();
  });

  it("rejects an empty string", () => {
    expect(parseTaskRef("")).toBeUndefined();
  });

  it("rejects a number large enough to overflow", () => {
    expect(parseTaskRef("99999999999999999999")).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(parseTaskRef("  t23  ")).toBe(23);
  });
});

describe("parseTaskRef accepts Devie's hyphenated T-001 form (issue #101)", () => {
  it("accepts an uppercase T-hyphen ref", () => {
    expect(parseTaskRef("T-23")).toBe(23);
  });

  it("accepts a lowercase t-hyphen ref with leading zeros", () => {
    expect(parseTaskRef("t-023")).toBe(23);
  });

  it("accepts the padded T-001 form", () => {
    expect(parseTaskRef("T-001")).toBe(1);
  });

  it("rejects a bare hyphen with no digits", () => {
    expect(parseTaskRef("T-")).toBeUndefined();
  });

  it("rejects T-0 — ids are 1-indexed", () => {
    expect(parseTaskRef("T-0")).toBeUndefined();
  });

  it("rejects a hyphen with no leading t", () => {
    expect(parseTaskRef("-23")).toBeUndefined();
  });
});

describe("formatTaskRef (issue #101)", () => {
  it("zero-pads to 3 digits", () => {
    expect(formatTaskRef(1)).toBe("T-001");
    expect(formatTaskRef(23)).toBe("T-023");
  });

  it("renders 4+ digit ids unpadded, never truncated", () => {
    expect(formatTaskRef(1000)).toBe("T-1000");
  });
});
