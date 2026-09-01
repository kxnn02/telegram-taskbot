import { describe, expect, it } from "vitest";
import { Bot, type Transformer } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import { notifyUser } from "./notify.js";

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

function makeTestBot() {
  const calls: { method: string }[] = [];
  const transformer: Transformer = async (_prev, method) => {
    calls.push({ method });
    return { ok: true, result: true } as never;
  };
  const bot = new Bot("TEST_TOKEN", { botInfo: FAKE_BOT_INFO });
  bot.api.config.use(transformer);
  return { bot, calls };
}

describe("notifyUser (issue #54/F5)", () => {
  it("returns false and does not throw when findTelegramId throws", async () => {
    const { bot } = makeTestBot();
    const registrations: RegistrationStorePort = {
      register: async () => {},
      findUsername: async () => undefined,
      findTelegramId: async () => {
        throw new Error("duplicate rows for username — .maybeSingle() failure");
      },
    };

    await expect(notifyUser(bot, registrations, "bob", "hi")).resolves.toBe(false);
  });

  it("returns false when there is no registration for that username", async () => {
    const { bot } = makeTestBot();
    const registrations: RegistrationStorePort = {
      register: async () => {},
      findUsername: async () => undefined,
      findTelegramId: async () => undefined,
    };

    expect(await notifyUser(bot, registrations, "bob", "hi")).toBe(false);
  });

  it("returns true when a message is actually sent", async () => {
    const { bot, calls } = makeTestBot();
    const registrations: RegistrationStorePort = {
      register: async () => {},
      findUsername: async () => undefined,
      findTelegramId: async () => 123,
    };

    expect(await notifyUser(bot, registrations, "bob", "hi")).toBe(true);
    expect(calls.some((c) => c.method === "sendMessage")).toBe(true);
  });
});
