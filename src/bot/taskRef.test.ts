import { describe, expect, it } from "vitest";
import { parseTaskRef } from "./taskRef.js";

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
