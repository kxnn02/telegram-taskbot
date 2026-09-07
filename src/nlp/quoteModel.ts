import { GroqTextModel } from "./groqTextModel.js";
import { ThrowingTextModel, type TextModel } from "./textModel.js";

/**
 * The real model behind `dailyQuote`. Uses `GroqTextModel`, matching every
 * other real call site in this repo (`api/telegram/webhook.ts`,
 * `src/bot/index.ts`) — the ticket's own wording pins `claude-haiku-4-5` /
 * `ANTHROPIC_API_KEY`, but the account behind that key has no billing
 * credit (issue #102 follow-up), the same reason the webhook's language
 * parser already substitutes Groq's free tier. `dailyQuote` degrades to
 * `''` on any model failure regardless of which provider is behind it, so
 * this keeps the actual behavior identical to the ticket's while using the
 * provider that can actually be called. Missing-key is handled as a
 * throwing model rather than a constructor throw, so a standup with no key
 * configured still renders (quote omitted) instead of 500ing.
 *
 * Moved here (issue #130, Build 0b) from `api/jobs/standup-push.ts` so the
 * settings page's standup preview/test routes can share the exact same
 * factory rather than a second copy.
 */
export function buildQuoteModel(): TextModel {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return new ThrowingTextModel(new Error("GROQ_API_KEY is not set."));
  return new GroqTextModel(apiKey);
}
