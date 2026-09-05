// The model port (issue #102 decision #4) — every call the parser makes to
// Claude goes through this interface, never through `@anthropic-ai/sdk`
// directly, so the fast test suite (ADR-0005) makes no network calls.
export interface TextModelRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface TextModel {
  complete(request: TextModelRequest): Promise<string>;
}

/** Test double: replays queued responses in call order, or — when given a
 * function instead — computes a response per request so a test can assert
 * against exactly what was sent. Throws if more calls arrive than
 * responses were queued, so a test's expected call count is enforced, not
 * just its outputs. */
export class FakeTextModel implements TextModel {
  private callIndex = 0;
  readonly requests: TextModelRequest[] = [];

  constructor(
    private readonly responses:
      | string[]
      | ((request: TextModelRequest, callIndex: number) => string),
  ) {}

  async complete(request: TextModelRequest): Promise<string> {
    this.requests.push(request);
    const index = this.callIndex++;
    if (typeof this.responses === "function") {
      return this.responses(request, index);
    }
    const response = this.responses[index];
    if (response === undefined) {
      throw new Error(`FakeTextModel: no response queued for call ${index}`);
    }
    return response;
  }
}

/** A model double whose every call rejects — for the "model throws" cases
 * every model-backed parser must degrade to its heuristic path against. */
export class ThrowingTextModel implements TextModel {
  constructor(private readonly error: Error = new Error("model unavailable")) {}
  async complete(): Promise<string> {
    throw this.error;
  }
}
