import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildQuoteModel } from "./quoteModel.js";
import { GroqTextModel } from "./groqTextModel.js";
import { ThrowingTextModel } from "./textModel.js";

describe("buildQuoteModel", () => {
  const originalKey = process.env.GROQ_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });

  it("returns a GroqTextModel when GROQ_API_KEY is set", () => {
    process.env.GROQ_API_KEY = "test-key";
    expect(buildQuoteModel()).toBeInstanceOf(GroqTextModel);
  });

  it("returns a ThrowingTextModel when GROQ_API_KEY is unset", async () => {
    delete process.env.GROQ_API_KEY;
    const model = buildQuoteModel();
    expect(model).toBeInstanceOf(ThrowingTextModel);
    await expect(model.complete({ system: "", user: "", maxTokens: 1 })).rejects.toThrow(
      "GROQ_API_KEY is not set.",
    );
  });
});
