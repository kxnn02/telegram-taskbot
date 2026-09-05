import { describe, expect, it } from "vitest";
import {
  extractLink,
  extractMeta,
  parseRefListItems,
  parseUpdateItems,
  parseUpdateSpecs,
  splitRefAndStatus,
} from "./updateBatch.js";

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

// ---- Issue #103 item 6: Devie's /update grammar --------------------------
// `extractLink`, `extractMeta`, `splitRefAndStatus` and `parseUpdateSpecs`
// are ported from `app/api/telegram/webhook/route.ts:316-412` @ `632a22c`,
// so a link and a note can ride along in an `/update`.

describe("extractLink (Devie route.ts:316)", () => {
  it("pulls a trailing link: off the end and returns the text without it", () => {
    expect(extractLink("t21 done link:https://example.com/pr/1")).toEqual({
      text: "t21 done",
      link: "https://example.com/pr/1",
    });
  });

  it("leaves text with no link: alone", () => {
    expect(extractLink("t21 done")).toEqual({ text: "t21 done" });
  });

  it("requires whitespace before link:, so a leading link: is not recognised (Devie's wart)", () => {
    expect(extractLink("link:https://example.com")).toEqual({
      text: "link:https://example.com",
    });
  });

  it("only accepts http/https URLs", () => {
    expect(extractLink("t21 done link:ftp://example.com")).toEqual({
      text: "t21 done link:ftp://example.com",
    });
  });
});

describe("extractMeta (Devie route.ts:322)", () => {
  it("pulls out both a link and a note", () => {
    expect(extractMeta("t21 done link:https://example.com/pr/1 note: ready for QA")).toEqual({
      text: "t21 done",
      link: "https://example.com/pr/1",
      note: "ready for QA",
    });
  });

  it("pulls out a note on its own", () => {
    expect(extractMeta("t21 done note: ready for QA")).toEqual({
      text: "t21 done",
      note: "ready for QA",
    });
  });

  it("pulls out a link on its own", () => {
    expect(extractMeta("t21 done link:https://example.com/pr/1")).toEqual({
      text: "t21 done",
      link: "https://example.com/pr/1",
    });
  });

  it("handles the note-before-link order too, since the link is stripped first", () => {
    expect(extractMeta("t21 done note: ready link:https://example.com/pr/1")).toEqual({
      text: "t21 done",
      link: "https://example.com/pr/1",
      note: "ready",
    });
  });

  it("leaves plain text untouched", () => {
    expect(extractMeta("t21 done")).toEqual({ text: "t21 done" });
  });

  it("leaves an empty 'note:' in the text — (.+) needs a character, and the input is trimmed first", () => {
    // Devie's `\s+note:\s*(.+)$` cannot match with zero characters after the
    // colon, and the leading `input.trim()` removes any trailing whitespace
    // that might have fed `(.+)`, so the token stays part of the text and
    // becomes status noise. Carbon-copied (#103 rule 2) — this is also why
    // Devie's own `note: note || undefined` guard is unreachable.
    expect(extractMeta("t21 done note:")).toEqual({ text: "t21 done note:" });
    expect(extractMeta("t21 done note:   ")).toEqual({ text: "t21 done note:" });
  });
});

describe("splitRefAndStatus (Devie route.ts:343)", () => {
  it("splits the trailing-status form", () => {
    expect(splitRefAndStatus("t21 done")).toEqual({ ref: "t21", statusRaw: "done" });
  });

  it("splits the leading-status form — 'done T-233'", () => {
    expect(splitRefAndStatus("done T-233")).toEqual({ ref: "T-233", statusRaw: "done" });
  });

  it("carries a link and a note alongside the ref and status", () => {
    expect(
      splitRefAndStatus("T-001 done link:https://example.com/pr/1 note: ready for QA"),
    ).toEqual({
      ref: "T-001",
      statusRaw: "done",
      link: "https://example.com/pr/1",
      note: "ready for QA",
    });
  });

  it("falls back to first-token-is-the-ref for status text it doesn't recognise", () => {
    expect(splitRefAndStatus("t21 working on it")).toEqual({
      ref: "t21",
      statusRaw: "working on it",
    });
  });

  it("returns null for a bare ref with no status at all", () => {
    expect(splitRefAndStatus("t21")).toBeNull();
  });

  it("returns null for an empty segment", () => {
    expect(splitRefAndStatus("   ")).toBeNull();
  });

  it("accepts the separator spellings of in progress but not 'inreview' (Devie's tail pattern)", () => {
    expect(splitRefAndStatus("t21 inprogress")).toEqual({ ref: "t21", statusRaw: "inprogress" });
    expect(splitRefAndStatus("t21 in progress")).toEqual({ ref: "t21", statusRaw: "in progress" });
    expect(splitRefAndStatus("t21 in review")).toEqual({ ref: "t21", statusRaw: "in review" });
    // `in[\s_-]+review` needs a separator, so "inreview" only survives via
    // the first-token fallback — same shape, but it is not a tail match.
    expect(splitRefAndStatus("t21 inreview")).toEqual({ ref: "t21", statusRaw: "inreview" });
  });
});

describe("parseUpdateSpecs (Devie route.ts:374)", () => {
  it("single: one ref and one status", () => {
    expect(parseUpdateSpecs("t21 done")).toEqual([{ ref: "t21", statusRaw: "done" }]);
  });

  it("comma-separated with one shared trailing status", () => {
    expect(parseUpdateSpecs("t21,t22,23 done")).toEqual([
      { ref: "t21", statusRaw: "done" },
      { ref: "t22", statusRaw: "done" },
      { ref: "23", statusRaw: "done" },
    ]);
  });

  it("comma-separated with one shared leading status — 'done t21,t22'", () => {
    expect(parseUpdateSpecs("done t21,t22")).toEqual([
      { ref: "t21", statusRaw: "done" },
      { ref: "t22", statusRaw: "done" },
    ]);
  });

  it("mixed per-task statuses, one per comma segment", () => {
    expect(parseUpdateSpecs("t21 done, t22 review, t23 inprogress")).toEqual([
      { ref: "t21", statusRaw: "done" },
      { ref: "t22", statusRaw: "review" },
      { ref: "t23", statusRaw: "inprogress" },
    ]);
  });

  it("multiline, one ref+status per line", () => {
    expect(parseUpdateSpecs("t31 done\nt30 review\n\nt32 blocked")).toEqual([
      { ref: "t31", statusRaw: "done" },
      { ref: "t30", statusRaw: "review" },
      { ref: "t32", statusRaw: "blocked" },
    ]);
  });

  it("carries a link through on the single-item path", () => {
    expect(parseUpdateSpecs("T-001 done link:https://example.com/pr/1")).toEqual([
      { ref: "T-001", statusRaw: "done", link: "https://example.com/pr/1" },
    ]);
  });

  it("carries a note through on the single-item path", () => {
    expect(parseUpdateSpecs("T-001 done note: ready for QA")).toEqual([
      { ref: "T-001", statusRaw: "done", note: "ready for QA" },
    ]);
  });

  it("carries a per-item link and note through on the bulk path", () => {
    expect(
      parseUpdateSpecs("t21 done note: shipped, t22 review link:https://example.com/pr/2"),
    ).toEqual([
      { ref: "t21", statusRaw: "done", note: "shipped" },
      { ref: "t22", statusRaw: "review", link: "https://example.com/pr/2" },
    ]);
  });

  it("empty input yields no specs", () => {
    expect(parseUpdateSpecs("")).toEqual([]);
    expect(parseUpdateSpecs("   ")).toEqual([]);
  });

  it("a bare ref with no status yields no specs", () => {
    expect(parseUpdateSpecs("t21")).toEqual([]);
  });

  it("the shared-status shortcut carries no link/note, exactly as Devie's own comment says", () => {
    expect(parseUpdateSpecs("t21,t22,t23 done")).toEqual([
      { ref: "t21", statusRaw: "done" },
      { ref: "t22", statusRaw: "done" },
      { ref: "t23", statusRaw: "done" },
    ]);
  });

  it("copies Devie's silent-drop wart: a segment that parses on its own survives, the rest vanish", () => {
    // "t21,t22 done link:<url>" parses neither per-item (t21 has no status)
    // nor as a shared status (the input ends in a URL, not a status word),
    // so Devie falls back to the per-item results with the nulls filtered
    // out — t21 is dropped with no error. Same for "t21 done, t22".
    expect(parseUpdateSpecs("t21,t22 done link:https://example.com/pr/1")).toEqual([
      { ref: "t22", statusRaw: "done", link: "https://example.com/pr/1" },
    ]);
    expect(parseUpdateSpecs("t21 done, t22")).toEqual([{ ref: "t21", statusRaw: "done" }]);
  });
});

describe("parseUpdateItems — /update's batch grammar (issue #32, on Devie's specs since #103)", () => {
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

  it("a bare ref with no status text at all yields no items, so /update replies with usage", () => {
    // Devie's grammar returns no spec at all here (splitRefAndStatus -> null)
    // rather than the empty-statusText item #32's own parser produced. Both
    // reach the same user-visible outcome — `/update t21` gets the usage
    // reply — because createBot treats an empty item list as usage too.
    expect(parseUpdateItems("t21")).toEqual([]);
  });

  it("an unparseable ref is kept with ref undefined so the batch can report it", () => {
    expect(parseUpdateItems("abc done")).toEqual([{ label: "abc", ref: undefined, statusText: "done" }]);
  });

  it("empty input yields no items", () => {
    expect(parseUpdateItems("")).toEqual([]);
  });

  it("carries a link and a note onto the item so /update can attach them", () => {
    expect(parseUpdateItems("t21 done link:https://example.com/pr/1 note: ready for QA")).toEqual([
      {
        label: "t21",
        ref: 21,
        statusText: "done",
        link: "https://example.com/pr/1",
        note: "ready for QA",
      },
    ]);
  });
});
