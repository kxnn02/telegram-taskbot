import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTextModel } from "./buildTextModel.js";
import { GroqTextModel } from "./groqTextModel.js";
import { parseStatus, parseBulkTasks, parseBulkTasksHeuristic } from "./parse.js";

describe("buildTextModel", () => {
  const originalKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });

  it("returns a GroqTextModel instance when GROQ_API_KEY is set", () => {
    process.env.GROQ_API_KEY = "test-key";
    expect(buildTextModel()).toBeInstanceOf(GroqTextModel);
  });

  it("does not throw when GROQ_API_KEY is unset", () => {
    delete process.env.GROQ_API_KEY;
    expect(() => buildTextModel()).not.toThrow();
  });

  it("rejects with 'GROQ_API_KEY is not set.' from complete() when unset", async () => {
    delete process.env.GROQ_API_KEY;
    const model = buildTextModel();
    await expect(model.complete({ system: "", user: "", maxTokens: 1 })).rejects.toThrow(
      "GROQ_API_KEY is not set.",
    );
  });

  it("degrades parseStatus to null when GROQ_API_KEY is unset", async () => {
    delete process.env.GROQ_API_KEY;
    const result = await parseStatus("done", buildTextModel());
    expect(result).toBeNull();
  });

  it("degrades parseBulkTasks to the heuristic result when GROQ_API_KEY is unset", async () => {
    delete process.env.GROQ_API_KEY;
    const message = "@alice Please finish the onboarding doc by Friday.";
    const referenceDate = new Date("2026-09-08T00:00:00.000Z");

    const result = await parseBulkTasks(message, buildTextModel(), referenceDate);
    const expected = parseBulkTasksHeuristic(message, referenceDate);

    expect(result.length).toBeGreaterThan(0);
    expect(result).toEqual(expected);
  });
});
