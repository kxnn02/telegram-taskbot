import { describe, expect, it } from "vitest";
import { levenshteinDistance, suggestClosestUsername } from "./usernameSuggest.js";

describe("levenshteinDistance", () => {
  it("is 0 for identical strings", () => {
    expect(levenshteinDistance("alice", "alice")).toBe(0);
  });

  it("counts a single substitution as distance 1", () => {
    expect(levenshteinDistance("alice", "alicw")).toBe(1);
  });

  it("counts a single insertion/deletion as distance 1", () => {
    expect(levenshteinDistance("alice", "alic")).toBe(1);
    expect(levenshteinDistance("alic", "alice")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(levenshteinDistance("Alice", "alice")).toBe(0);
  });
});

describe("suggestClosestUsername", () => {
  const candidates = ["alice", "bob", "carla"];

  it("suggests the single close match for a small typo", () => {
    expect(suggestClosestUsername("alicw", candidates)).toBe("alice");
  });

  it("suggests a match within distance 2", () => {
    expect(suggestClosestUsername("alicwx", candidates)).toBe("alice");
  });

  it("returns undefined when no candidate is close enough", () => {
    expect(suggestClosestUsername("zephyr", candidates)).toBeUndefined();
  });

  it("returns undefined when two candidates are equally close (ambiguous)", () => {
    // "bob" and "boc" are not real, use two close-together fake names
    expect(suggestClosestUsername("alicx", ["alice", "alicy"])).toBeUndefined();
  });

  it("returns undefined for an exact match already (nothing to suggest)", () => {
    expect(suggestClosestUsername("alice", candidates)).toBeUndefined();
  });

  it("is case-insensitive and ignores a leading @", () => {
    expect(suggestClosestUsername("@Alicw", candidates)).toBe("alice");
  });
});
