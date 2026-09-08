import { GroqTextModel } from "./groqTextModel.js";
import { ThrowingTextModel, type TextModel } from "./textModel.js";

/**
 * The one place that decides what happens when `GROQ_API_KEY` is absent.
 *
 * Returns a model that fails on *use* rather than on construction (issue
 * #142). Every parser in `parse.ts` already catches a throwing `complete()`
 * and degrades — `parseBulkTasks` to its heuristic, `parseStatus` to null —
 * so a deployment with no key configured loses only the language features.
 * A constructor throw, by contrast, escaped `buildDeps()` and 500'd every
 * command for 17 hours on 2026-09-07.
 */
export function buildTextModel(): TextModel {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return new ThrowingTextModel(new Error("GROQ_API_KEY is not set."));
  return new GroqTextModel(apiKey);
}
