import { describe, expect, it } from "vitest";
import {
  CERT_TIPS,
  renderCertTipHtml,
  renderCertTipPlain,
  selectCertTipForDate,
} from "./certTips.js";

// Issue #180: the rotating CCA-F certification tip that replaces the books
// reminder. Selection is a date-seeded shuffled cycle — deterministic, no
// `Math.random()` — so the dashboard's Preview always matches what posts.

describe("CERT_TIPS", () => {
  it("has exactly 30 entries with ids 1..30, no duplicates", () => {
    expect(CERT_TIPS.length).toBe(30);
    const ids = CERT_TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(30);
    expect([...ids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it("no rendered tip (HTML, including attribution) exceeds 220 characters", () => {
    for (const tip of CERT_TIPS) {
      const html = renderCertTipHtml(tip);
      expect(html.length).toBeLessThanOrEqual(220);
    }
  });
});

describe("selectCertTipForDate", () => {
  it("is deterministic: the same Manila date always yields the same tip", () => {
    const now = new Date("2026-09-10T04:00:00.000Z"); // ~noon Manila
    const a = selectCertTipForDate(now);
    const b = selectCertTipForDate(now);
    expect(a).toEqual(b);

    const sameManilaDayLater = new Date("2026-09-10T10:00:00.000Z");
    expect(selectCertTipForDate(sameManilaDayLater)).toEqual(a);
  });

  it("over 30 consecutive days, all 30 tips appear exactly once", () => {
    // Cycle-aligned start (Manila epoch day divisible by 30) so this window
    // covers exactly one full cycle, not a straddle of two.
    const start = new Date("2026-09-05T04:00:00.000Z");
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const day = new Date(start.getTime() + i * 86_400_000);
      const tip = selectCertTipForDate(day);
      seen.add(tip.id);
    }
    expect(seen.size).toBe(30);
  });

  it("day 31 starts a new cycle with a different order than days 1-30", () => {
    const start = new Date("2026-09-05T04:00:00.000Z"); // cycle-aligned
    const firstCycle = Array.from({ length: 30 }, (_, i) =>
      selectCertTipForDate(new Date(start.getTime() + i * 86_400_000)).id,
    );
    const secondCycle = Array.from({ length: 30 }, (_, i) =>
      selectCertTipForDate(new Date(start.getTime() + (i + 30) * 86_400_000)).id,
    );
    expect(secondCycle).not.toEqual(firstCycle);
    // Still a full permutation of all 30 ids.
    expect(new Set(secondCycle).size).toBe(30);
  });
});

describe("renderCertTipHtml / renderCertTipPlain", () => {
  const tip = {
    id: 1,
    lead: "Trust your prep and stop putting it off.",
    body: "Don't let anxiety delay you.",
    from: "Kim Fajardo",
  };

  it("renders the HTML variant with the expected shape", () => {
    expect(renderCertTipHtml(tip)).toBe(
      "💡 <b>Trust your prep and stop putting it off.</b> Don't let anxiety delay you.\n— <i>Kim Fajardo</i>",
    );
  });

  it("renders the plain variant with the expected shape", () => {
    expect(renderCertTipPlain(tip)).toBe(
      "💡 Trust your prep and stop putting it off. Don't let anxiety delay you.\n— Kim Fajardo",
    );
  });

  it("HTML renderer escapes <, >, & in all three fields", () => {
    const dangerous = { id: 2, lead: "A < B & C", body: "x > y & z", from: "<b>Bold</b> & Co" };
    const html = renderCertTipHtml(dangerous);
    expect(html).not.toContain("<b>Bold</b> & Co");
    expect(html).toContain("A &lt; B &amp; C");
    expect(html).toContain("x &gt; y &amp; z");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt; &amp; Co");
  });

  it("emits no trailing space after the lead when body is empty", () => {
    const noBody = { id: 3, lead: "Just a lead.", body: "", from: "Someone" };
    expect(renderCertTipHtml(noBody)).toBe("💡 <b>Just a lead.</b>\n— <i>Someone</i>");
    expect(renderCertTipPlain(noBody)).toBe("💡 Just a lead.\n— Someone");
  });
});
