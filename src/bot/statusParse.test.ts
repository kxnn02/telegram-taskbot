import { describe, expect, it } from "vitest";
import { parseStatusWord, VALID_STATUS_WORDS_TEXT } from "./statusParse.js";

// Exhaustive over #27's normative "accepted in commands" column — this
// table is the spec, so every accepted spelling is pinned individually
// rather than sampled (issue #31 acceptance criteria).
describe("parseStatusWord (issue #27's status-word table)", () => {
  it.each([
    ["backlog", "backlog"],
    ["todo", "todo"],
    ["to-do", "todo"],
    ["inprogress", "in_progress"],
    ["in-progress", "in_progress"],
    ["in progress", "in_progress"],
    ["wip", "in_progress"],
    ["review", "in_review"],
    ["inreview", "in_review"],
    ["in-review", "in_review"],
    ["in review", "in_review"],
    ["blocked", "blocked"],
    ["done", "done"],
    ["complete", "done"],
    ["completed", "done"],
  ] as const)("%s -> %s", (input, expected) => {
    expect(parseStatusWord(input)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(parseStatusWord("In Progress")).toBe("in_progress");
    expect(parseStatusWord("DONE")).toBe("done");
  });

  it("tolerates surrounding whitespace and repeated internal spaces", () => {
    expect(parseStatusWord("  in   progress  ")).toBe("in_progress");
  });

  it("rejects an unrecognised word", () => {
    expect(parseStatusWord("finished")).toBeUndefined();
  });

  it("rejects an empty string", () => {
    expect(parseStatusWord("")).toBeUndefined();
  });

  it("exposes a human-readable list of valid words for the error reply", () => {
    expect(VALID_STATUS_WORDS_TEXT).toMatch(/backlog/);
    expect(VALID_STATUS_WORDS_TEXT).toMatch(/todo/);
    expect(VALID_STATUS_WORDS_TEXT).toMatch(/in progress/);
    expect(VALID_STATUS_WORDS_TEXT).toMatch(/in review/);
    expect(VALID_STATUS_WORDS_TEXT).toMatch(/blocked/);
    expect(VALID_STATUS_WORDS_TEXT).toMatch(/done/);
  });
});
