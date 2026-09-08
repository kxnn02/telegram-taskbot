import { describe, expect, it } from "vitest";
import { Bot, type Transformer } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { attachAutoRetry } from "./attachAutoRetry.js";

const FAKE_BOT_INFO: UserFromGetMe = {
  id: 999,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

// A fake transport that stands in for grammy's raw HTTP call — installed
// *before* attachAutoRetry so the auto-retry transformer wraps it (grammy
// composes `config.use()` calls outermost-last, so auto-retry must be
// registered after this fake to see its {ok:false} results and retry them).
function makeBotWithFakeTransport(transport: Transformer) {
  const bot = new Bot("TEST_TOKEN", { botInfo: FAKE_BOT_INFO });
  bot.api.config.use(transport);
  return bot;
}

describe("attachAutoRetry", () => {
  it("retries a sendMessage call that failed with a 429, and succeeds on the retry", async () => {
    let attempts = 0;
    const bot = makeBotWithFakeTransport(async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 0",
          parameters: { retry_after: 0 },
        } as never;
      }
      return { ok: true, result: true } as never;
    });
    attachAutoRetry(bot);

    await expect(bot.api.sendMessage(123, "hi")).resolves.toBe(true);
    expect(attempts).toBe(2);
  });

  it("gives up and rethrows once maxRetryAttempts is exhausted", async () => {
    let attempts = 0;
    const bot = makeBotWithFakeTransport(async () => {
      attempts += 1;
      return {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 0",
        parameters: { retry_after: 0 },
      } as never;
    });
    attachAutoRetry(bot, { maxRetryAttempts: 2 });

    await expect(bot.api.sendMessage(123, "hi")).rejects.toThrow();
    expect(attempts).toBe(3); // the original call plus 2 retries
  });

  it("does not retry (and fails immediately) when no auto-retry is attached", async () => {
    let attempts = 0;
    const bot = makeBotWithFakeTransport(async () => {
      attempts += 1;
      return {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 0",
        parameters: { retry_after: 0 },
      } as never;
    });

    await expect(bot.api.sendMessage(123, "hi")).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
