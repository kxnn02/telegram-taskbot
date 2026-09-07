import { describe, expect, it } from "vitest";
import { esc } from "./html.js";

/**
 * Issue #124 stage S3: the one consolidated HTML-escape helper, replacing
 * four duplicated private copies (`bulkTaskCreate.ts`, `fanOut.ts`,
 * `tasksPage.ts`, `format.ts`) and one exported copy (`standupCard.ts`).
 * Behaviour is identical to every prior copy: `&` -> `&amp;`, `<` -> `&lt;`,
 * `>` -> `&gt;`, in that order.
 */
describe("esc", () => {
  it("leaves plain text untouched", () => {
    expect(esc("hello world")).toBe("hello world");
  });

  it("escapes & alone", () => {
    expect(esc("a & b")).toBe("a &amp; b");
  });

  it("escapes < alone", () => {
    expect(esc("a < b")).toBe("a &lt; b");
  });

  it("escapes > alone", () => {
    expect(esc("a > b")).toBe("a &gt; b");
  });

  it("escapes all three combined", () => {
    expect(esc("<b>a & b</b>")).toBe("&lt;b&gt;a &amp; b&lt;/b&gt;");
  });

  it("escapes & before < and >, so < does not become &lt; and then get its own & re-escaped", () => {
    // If '&' were escaped *after* '<'/'>', the '&' introduced by escaping
    // '<' into '&lt;' would itself get escaped into '&amp;lt;' — asserting
    // the fixed order catches that regression directly.
    expect(esc("<")).toBe("&lt;");
    expect(esc(">")).toBe("&gt;");
    expect(esc("&<>")).toBe("&amp;&lt;&gt;");
  });
});
