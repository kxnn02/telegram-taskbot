import { describe, expect, it, vi } from "vitest";
import type { Update } from "grammy/types";
import { handleTelegramWebhook, type WebhookHandlerDeps } from "./webhookHandler.js";

const SECRET = "test-secret-token";

function makeUpdate(updateId: number): Update {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 1, type: "private" },
      from: { id: 1, is_bot: false, first_name: "Test" },
      text: "/help",
    },
  } as Update;
}

function makeDeps(overrides: Partial<WebhookHandlerDeps> = {}): WebhookHandlerDeps & {
  handleUpdate: ReturnType<typeof vi.fn>;
} {
  const handleUpdate = vi.fn(async () => {});
  return {
    bot: { handleUpdate },
    expectedSecret: SECRET,
    claimUpdate: vi.fn(async () => true),
    handleUpdate,
    ...overrides,
  };
}

describe("handleTelegramWebhook", () => {
  it("responds 401 and does nothing else when the secret header is missing", async () => {
    const deps = makeDeps();
    const result = await handleTelegramWebhook(deps, {
      headers: {},
      body: makeUpdate(1),
    });
    expect(result.status).toBe(401);
    expect(deps.handleUpdate).not.toHaveBeenCalled();
    expect(deps.claimUpdate).not.toHaveBeenCalled();
  });

  it("responds 401 when the secret header doesn't match", async () => {
    const deps = makeDeps();
    const result = await handleTelegramWebhook(deps, {
      headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
      body: makeUpdate(1),
    });
    expect(result.status).toBe(401);
    expect(deps.handleUpdate).not.toHaveBeenCalled();
  });

  it("processes a valid update and responds 200", async () => {
    const deps = makeDeps();
    const update = makeUpdate(42);
    const result = await handleTelegramWebhook(deps, {
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: update,
    });
    expect(result.status).toBe(200);
    expect(deps.claimUpdate).toHaveBeenCalledWith(42);
    expect(deps.handleUpdate).toHaveBeenCalledWith(update);
  });

  it("accepts the secret header as an array (some runtimes normalize headers this way)", async () => {
    const deps = makeDeps();
    const result = await handleTelegramWebhook(deps, {
      headers: { "x-telegram-bot-api-secret-token": [SECRET] },
      body: makeUpdate(1),
    });
    expect(result.status).toBe(200);
  });

  it("is a no-op (200, no bot.handleUpdate call) when claimUpdate reports a duplicate", async () => {
    const deps = makeDeps({ claimUpdate: vi.fn(async () => false) });
    const result = await handleTelegramWebhook(deps, {
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: makeUpdate(42),
    });
    expect(result.status).toBe(200);
    expect(deps.handleUpdate).not.toHaveBeenCalled();
  });

  it("responds 400 for a body with no update_id", async () => {
    const deps = makeDeps();
    const result = await handleTelegramWebhook(deps, {
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: { not: "an update" },
    });
    expect(result.status).toBe(400);
    expect(deps.claimUpdate).not.toHaveBeenCalled();
  });
});
