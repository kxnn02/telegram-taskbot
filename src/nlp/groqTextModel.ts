import type { TextModel, TextModelRequest } from "./textModel.js";

/**
 * Free-tier alternative to `AnthropicTextModel` (issue #102 follow-up: the
 * account behind `ANTHROPIC_API_KEY` has no billing credit, and can't be
 * funded). Groq's free, no-credit-card tier — 30 requests/min, 14,400/day —
 * runs open-weight models on their own inference hardware; this repo's
 * language parser (`src/nlp/parse.ts`) doesn't care which `TextModel`
 * backs it, so switching back to Anthropic later (or to any other
 * provider) never touches `parse.ts` or its tests.
 *
 * `qwen/qwen3.6-27b`, not one of the `openai/gpt-oss-*` models available
 * on this account: those are reasoning models whose "thinking" tokens come
 * out of the same `max_completion_tokens` budget as the actual answer, so
 * every call site's tight budget (`parseStatus`'s 20 tokens, in
 * particular) came back empty — the model spent its whole allowance
 * thinking and never got to write "done". Qwen3 is also a reasoning model
 * by default, but — unlike the `gpt-oss` family on Groq — accepts
 * `reasoning_effort: "none"` to turn thinking off outright, verified
 * directly (clean, correctly-structured JSON back from a real bulk-task
 * prompt with no reasoning preamble) rather than assumed from docs.
 */
export const GROQ_MODEL_ID = "qwen/qwen3.6-27b";

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

export class GroqTextModel implements TextModel {
  constructor(private readonly apiKey: string = requireApiKey()) {}

  async complete({ system, user, maxTokens }: TextModelRequest): Promise<string> {
    const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL_ID,
        max_completion_tokens: maxTokens,
        reasoning_effort: "none",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Groq API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as GroqChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }
}

function requireApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set.");
  return key;
}
