import Anthropic from "@anthropic-ai/sdk";
import type { TextModel, TextModelRequest } from "./textModel.js";

/** Verified 2026-09-04 against DevieBot's `lib/nlp.ts` (all four call
 * sites): a current, cheap model, already tuned over four months of
 * cohort use. Do not substitute a larger model — see issue #102 decision
 * #5. One exported constant, not inline at every call site. */
export const NLP_MODEL_ID = "claude-haiku-4-5";

/**
 * The real `TextModel`, wired directly to `@anthropic-ai/sdk`. Infra
 * wire-up, not unit-tested here for the same reason as
 * `src/jobs/buildJobDeps.ts`: every parser in `parse.ts` is tested against
 * `FakeTextModel`/`ThrowingTextModel` instead.
 */
export class AnthropicTextModel implements TextModel {
  private readonly client: Anthropic;

  constructor(apiKey: string = requireApiKey()) {
    this.client = new Anthropic({ apiKey });
  }

  async complete({ system, user, maxTokens }: TextModelRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: NLP_MODEL_ID,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = response.content[0];
    if (!block || block.type !== "text") return "";
    return block.text.trim();
  }
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  return key;
}
