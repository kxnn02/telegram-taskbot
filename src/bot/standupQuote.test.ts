import { describe, expect, it } from "vitest";
import { FakeTextModel, ThrowingTextModel } from "../nlp/textModel.js";
import { dailyQuote } from "./standupQuote.js";

// Issue #107: Devie's `dailyQuote()` (`lib/standup.ts:26`) — a Haiku call
// for one verbatim quote from a fixed list of six books, ported behind the
// `TextModel` port (issue #102) so the fast suite makes no network calls
// (ADR-0005). "On any error it returns '' and the standup ships without a
// quote" is the one behaviour this function must never violate.

describe("dailyQuote", () => {
  it("parses a well-formed reply (em dash) into the two-line HTML form", async () => {
    const model = new FakeTextModel([
      '"Do what you say you\'re going to do." — Julie Zhuo, The Making of a Manager',
    ]);
    const result = await dailyQuote(model);
    expect(result).toBe(
      '<i>"Do what you say you\'re going to do."</i>\n— <i>Julie Zhuo, The Making of a Manager</i>',
    );
  });

  it("parses a reply that uses a hyphen instead of an em/en dash", async () => {
    const model = new FakeTextModel(['"Ideas are cheap." - Peter Thiel, Zero to One']);
    const result = await dailyQuote(model);
    expect(result).toBe('<i>"Ideas are cheap."</i>\n— <i>Peter Thiel, Zero to One</i>');
  });

  it("parses a reply that uses an en dash", async () => {
    const model = new FakeTextModel(['"Ideas are cheap." – Peter Thiel, Zero to One']);
    const result = await dailyQuote(model);
    expect(result).toBe('<i>"Ideas are cheap."</i>\n— <i>Peter Thiel, Zero to One</i>');
  });

  it("italicises an unparseable reply whole", async () => {
    const model = new FakeTextModel(["I cannot provide that quote right now."]);
    const result = await dailyQuote(model);
    expect(result).toBe("<i>I cannot provide that quote right now.</i>");
  });

  it("returns '' when the model throws", async () => {
    const model = new ThrowingTextModel(new Error("rate limited"));
    const result = await dailyQuote(model);
    expect(result).toBe("");
  });

  it("returns '' when the model returns an empty string", async () => {
    const model = new FakeTextModel([""]);
    const result = await dailyQuote(model);
    expect(result).toBe("");
  });

  it("returns '' when the model returns only whitespace", async () => {
    const model = new FakeTextModel(["   \n  "]);
    const result = await dailyQuote(model);
    expect(result).toBe("");
  });

  it("escapes HTML-significant characters in an unparseable reply", async () => {
    const model = new FakeTextModel(["<script>alert(1)</script> & friends"]);
    const result = await dailyQuote(model);
    expect(result).toBe("<i>&lt;script&gt;alert(1)&lt;/script&gt; &amp; friends</i>");
  });
});
