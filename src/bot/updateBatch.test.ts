import { describe, expect, it } from "vitest";
import { parseRefListItems, parseUpdateItems } from "./updateBatch.js";

describe("parseRefListItems — /done and /complete ref lists (issue #32)", () => {
  it("parses a single ref with no status text", () => {
    expect(parseRefListItems("21")).toEqual([{ label: "21", ref: 21, statusText: undefined }]);
  });

  it("splits a comma-separated ref list, tolerating spaces around commas", () => {
    expect(parseRefListItems("t21, t22 ,23")).toEqual([
      { label: "t21", ref: 21, statusText: undefined },
      { label: "t22", ref: 22, statusText: undefined },
      { label: "23", ref: 23, statusText: undefined },
    ]);
  });

  it("keeps an unparseable token with ref undefined instead of dropping it", () => {
    expect(parseRefListItems("21,abc,22")).toEqual([
      { label: "21", ref: 21, statusText: undefined },
      { label: "abc", ref: undefined, statusText: undefined },
      { label: "22", ref: 22, statusText: undefined },
    ]);
  });

  it("empty input yields no items", () => {
    expect(parseRefListItems("")).toEqual([]);
  });
});

describe("parseUpdateItems — /update's batch grammar (issue #32)", () => {
  it("a single '<ref> <status>' is the one-item case", () => {
    expect(parseUpdateItems("t21 done")).toEqual([{ label: "t21", ref: 21, statusText: "done" }]);
  });

  it("format A: one trailing status governs a comma-separated ref list", () => {
    expect(parseUpdateItems("t21,t22,23 done")).toEqual([
      { label: "t21", ref: 21, statusText: "done" },
      { label: "t22", ref: 22, statusText: "done" },
      { label: "23", ref: 23, statusText: "done" },
    ]);
  });

  it("format B: mixed statuses, one per comma segment", () => {
    expect(parseUpdateItems("t21 done, t22 review, t23 inprogress")).toEqual([
      { label: "t21", ref: 21, statusText: "done" },
      { label: "t22", ref: 22, statusText: "review" },
      { label: "t23", ref: 23, statusText: "inprogress" },
    ]);
  });

  it("multiline batch: newline-separated pairs, independent of comma grouping", () => {
    expect(parseUpdateItems("t21 done\nt22 review\n\nt23 blocked")).toEqual([
      { label: "t21", ref: 21, statusText: "done" },
      { label: "t22", ref: 22, statusText: "review" },
      { label: "t23", ref: 23, statusText: "blocked" },
    ]);
  });

  it("a bare ref with no status text at all reports an empty statusText, not a crash", () => {
    expect(parseUpdateItems("t21")).toEqual([{ label: "t21", ref: 21, statusText: "" }]);
  });

  it("an unparseable ref is kept with ref undefined so the batch can report it", () => {
    expect(parseUpdateItems("abc done")).toEqual([{ label: "abc", ref: undefined, statusText: "done" }]);
  });

  it("empty input yields no items", () => {
    expect(parseUpdateItems("")).toEqual([]);
  });
});
