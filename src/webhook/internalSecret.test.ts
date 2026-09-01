import { describe, expect, it } from "vitest";
import { headerValue, secretMatches } from "./internalSecret.js";

describe("secretMatches", () => {
  it("matches when candidate equals expected", () => {
    expect(secretMatches("abc123", "abc123")).toBe(true);
  });

  it("rejects a mismatched candidate", () => {
    expect(secretMatches("wrong", "abc123")).toBe(false);
  });

  it("rejects an undefined candidate without throwing", () => {
    expect(secretMatches(undefined, "abc123")).toBe(false);
  });

  it("rejects a candidate of different length without touching timingSafeEqual", () => {
    expect(secretMatches("short", "a-much-longer-expected-value")).toBe(false);
  });
});

describe("headerValue", () => {
  it("returns a plain string header value", () => {
    expect(headerValue({ "x-foo": "bar" }, "x-foo")).toBe("bar");
  });

  it("returns the first entry of an array header value", () => {
    expect(headerValue({ "x-foo": ["bar", "baz"] }, "x-foo")).toBe("bar");
  });

  it("returns undefined for a missing header", () => {
    expect(headerValue({}, "x-foo")).toBeUndefined();
  });
});
