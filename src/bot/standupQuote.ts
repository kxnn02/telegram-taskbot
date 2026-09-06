import type { TextModel } from "../nlp/textModel.js";
import { esc } from "./standupCard.js";

/**
 * Issue #107, deviation #4: Devie's `dailyQuote()` (`lib/standup.ts:26`) —
 * the standup's second Anthropic call site (after `lib/nlp.ts`, ported
 * behind the `TextModel` port in issue #102). The model is injected here,
 * never constructed — this is the whole reason this ticket was blocked on
 * #102, and it's what keeps the fast suite network-free (ADR-0005).
 */

/** The fixed list of six books Devie's prompt asks the model to quote from,
 * copied verbatim. */
const QUOTE_BOOKS = [
  { title: "How to Say It", author: "Rosalie Maggio" },
  { title: "Startup Mindsets", author: "Earl Valencia and Dan Gonzales" },
  { title: "Simply Said", author: "Jay Sullivan" },
  { title: "The Making of a Manager", author: "Julie Zhuo" },
  { title: "Outliers", author: "Malcolm Gladwell" },
  { title: "Zero to One", author: "Peter Thiel" },
] as const;

/** Devie pins `claude-haiku-4-5`, `max_tokens: 200` — the same model #102
 * pins for the language parser. The model name itself isn't part of the
 * `TextModelRequest` shape (that's the port's job to route), so it's
 * documented here rather than sent on every call. */
export const QUOTE_MAX_TOKENS = 200;

/** Devie's required reply format: `"<quote>" — <Author>, <Book Title>`.
 * Accepts an em dash, en dash, or a plain hyphen (one or more), matching
 * Devie's own parse regex (`lib/standup.ts`'s `/^"(.+?)"\s*[—–-]+\s*(.+)$/`). */
const QUOTE_REPLY_RE = /^"(.+?)"\s*[—–-]+\s*(.+)$/;

function buildPrompt(): { system: string; user: string } {
  const bookList = QUOTE_BOOKS.map((b) => `- ${b.title} by ${b.author}`).join("\n");
  return {
    system:
      "You are picking one short, verbatim quote to open a software team's daily standup. " +
      "Pick exactly one of the following six books at random, and vary your choice each time " +
      `you are asked:\n${bookList}\n\n` +
      'Reply with the quote in exactly this format and nothing else: "<quote>" — <Author>, <Book Title>',
    user: "Give me today's quote.",
  };
}

/**
 * Devie's `dailyQuote()`. On a parseable reply, renders the two-line
 * `<i>"quote"</i>\n— <i>author, book</i>` form; on an unparseable one,
 * italicises the raw text. **On any error — a throw, or an empty/blank
 * reply — this returns `''` and the standup ships without a quote.** Copied
 * deliberately: the standup must never fail because the model did.
 */
export async function dailyQuote(model: TextModel): Promise<string> {
  try {
    const { system, user } = buildPrompt();
    const raw = await model.complete({ system, user, maxTokens: QUOTE_MAX_TOKENS });
    const trimmed = raw.trim();
    if (trimmed === "") return "";

    const match = QUOTE_REPLY_RE.exec(trimmed);
    if (match) {
      const [, quote, attribution] = match;
      return `<i>"${esc(quote!)}"</i>\n— <i>${esc(attribution!.trim())}</i>`;
    }
    return `<i>${esc(trimmed)}</i>`;
  } catch {
    return "";
  }
}
