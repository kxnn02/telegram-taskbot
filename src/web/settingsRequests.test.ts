import { describe, expect, it } from "vitest";
import {
  parseSaveSettingsRequest,
  planDashboardWebhookRegistration,
  parseStandupRequest,
  isMaintainer,
  stripWebhookUrlQuery,
  buildWebhookStatusResponse,
} from "./settingsRequests.js";

describe("parseSaveSettingsRequest", () => {
  it("accepts a groupChatId string", () => {
    const result = parseSaveSettingsRequest({ groupChatId: "-1001234567890" });
    expect(result).toEqual({ ok: true, value: { groupChatId: "-1001234567890" } });
  });

  it("accepts an empty string as 'clear the group chat id'", () => {
    const result = parseSaveSettingsRequest({ groupChatId: "" });
    expect(result).toEqual({ ok: true, value: { groupChatId: "" } });
  });

  it("rejects a missing groupChatId field", () => {
    const result = parseSaveSettingsRequest({});
    expect(result.ok).toBe(false);
  });

  it("rejects a non-string groupChatId", () => {
    const result = parseSaveSettingsRequest({ groupChatId: 12345 });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseSaveSettingsRequest(null).ok).toBe(false);
    expect(parseSaveSettingsRequest("nope").ok).toBe(false);
    expect(parseSaveSettingsRequest([]).ok).toBe(false);
  });
});

describe("parseStandupRequest", () => {
  it("accepts mode: preview", () => {
    expect(parseStandupRequest({ mode: "preview" })).toEqual({
      ok: true,
      value: { mode: "preview" },
    });
  });

  it("accepts mode: test", () => {
    expect(parseStandupRequest({ mode: "test" })).toEqual({
      ok: true,
      value: { mode: "test" },
    });
  });

  it("accepts mode: enable", () => {
    expect(parseStandupRequest({ mode: "enable" })).toEqual({
      ok: true,
      value: { mode: "enable" },
    });
  });

  it("accepts mode: disable", () => {
    expect(parseStandupRequest({ mode: "disable" })).toEqual({
      ok: true,
      value: { mode: "disable" },
    });
  });

  it("rejects a missing mode field", () => {
    expect(parseStandupRequest({}).ok).toBe(false);
  });

  it("rejects an unrecognized mode value", () => {
    expect(parseStandupRequest({ mode: "send" }).ok).toBe(false);
  });

  it("rejects a malformed (non-object) body", () => {
    expect(parseStandupRequest(null).ok).toBe(false);
    expect(parseStandupRequest("nope").ok).toBe(false);
    expect(parseStandupRequest([]).ok).toBe(false);
  });
});

describe("isMaintainer", () => {
  it("matches the same username", () => {
    expect(isMaintainer({ username: "kxnn02", cohortId: "c1" }, "kxnn02")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMaintainer({ username: "KxNn02", cohortId: "c1" }, "kxnn02")).toBe(true);
  });

  it("ignores a leading @ on either side", () => {
    expect(isMaintainer({ username: "@kxnn02", cohortId: "c1" }, "kxnn02")).toBe(true);
    expect(isMaintainer({ username: "kxnn02", cohortId: "c1" }, "@kxnn02")).toBe(true);
  });

  it("rejects a different username", () => {
    expect(isMaintainer({ username: "someoneelse", cohortId: "c1" }, "kxnn02")).toBe(false);
  });
});

describe("stripWebhookUrlQuery", () => {
  it("removes the query string, keeping origin and path", () => {
    expect(
      stripWebhookUrlQuery(
        "https://example.vercel.app/api/telegram/webhook?x-vercel-protection-bypass=secret",
      ),
    ).toBe("https://example.vercel.app/api/telegram/webhook");
  });

  it("passes through a URL with no query string unchanged", () => {
    expect(stripWebhookUrlQuery("https://example.vercel.app/api/telegram/webhook")).toBe(
      "https://example.vercel.app/api/telegram/webhook",
    );
  });

  it("returns an empty string as-is (webhook not registered)", () => {
    expect(stripWebhookUrlQuery("")).toBe("");
  });
});

describe("buildWebhookStatusResponse", () => {
  it("shapes a registered webhook, stripping its query string", () => {
    expect(
      buildWebhookStatusResponse({
        url: "https://example.vercel.app/api/telegram/webhook?x-vercel-protection-bypass=secret",
        pending_update_count: 0,
      }),
    ).toEqual({
      url: "https://example.vercel.app/api/telegram/webhook",
      pendingCount: 0,
      lastError: undefined,
    });
  });

  it("carries through a last_error_message", () => {
    expect(
      buildWebhookStatusResponse({
        url: "https://example.vercel.app/api/telegram/webhook",
        pending_update_count: 3,
        last_error_message: "Connection timed out",
      }),
    ).toEqual({
      url: "https://example.vercel.app/api/telegram/webhook",
      pendingCount: 3,
      lastError: "Connection timed out",
    });
  });

  it("shapes an unregistered webhook (empty url)", () => {
    expect(
      buildWebhookStatusResponse({ url: "", pending_update_count: 0 }),
    ).toEqual({ url: "", pendingCount: 0, lastError: undefined });
  });
});

describe("planDashboardWebhookRegistration", () => {
  /** The env a correctly-configured production deployment presents. */
  function productionEnv(overrides: Record<string, string | undefined> = {}) {
    return {
      PROD_BOT_USERNAME: "devcon_cohort5_taskbot",
      PRODUCTION_DEPLOYMENT_URL: "https://telegram-taskbot-ten.vercel.app",
      TELEGRAM_WEBHOOK_SECRET: "production-secret",
      VERCEL_PROTECTION_BYPASS: "bypass",
      ...overrides,
    };
  }

  it("registers production's webhook when the deployment really holds the production bot", () => {
    const plan = planDashboardWebhookRegistration({
      actualBotUsername: "devcon_cohort5_taskbot",
      env: productionEnv(),
    });
    expect(plan.ok).toBe(true);
    expect(plan.ok === true && plan.url).toContain("telegram-taskbot-ten.vercel.app");
  });

  it("refuses when pressed on the dry-run deployment, which holds the dry-run bot", () => {
    // The hazard this closes: the route hardcodes PRODUCTION_DEPLOYMENT_URL as
    // its destination, but ran its identity check against the deployment's own
    // BOT_USERNAME. On the dry-run deployment both are the dry-run bot, so the
    // check agreed with itself and Register would have pointed the DRY-RUN bot
    // at PRODUCTION's URL — killing the dry-run loop and crossing the two.
    const plan = planDashboardWebhookRegistration({
      actualBotUsername: "devcon_c5_taskbot_test_bot",
      env: productionEnv({ DRYRUN_BOT_USERNAME: "devcon_c5_taskbot_test_bot" }),
    });
    expect(plan.ok).toBe(false);
  });

  it("refuses rather than guessing when PROD_BOT_USERNAME is not configured", () => {
    // Fail closed: an unset variable must not fall back to BOT_USERNAME, which
    // is whatever bot the current deployment happens to run as.
    const plan = planDashboardWebhookRegistration({
      actualBotUsername: "devcon_c5_taskbot_test_bot",
      env: productionEnv({ PROD_BOT_USERNAME: undefined }),
    });
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain("PROD_BOT_USERNAME");
  });

  it("ignores BOT_USERNAME entirely, however it is set", () => {
    const plan = planDashboardWebhookRegistration({
      actualBotUsername: "devcon_c5_taskbot_test_bot",
      env: productionEnv({ BOT_USERNAME: "devcon_c5_taskbot_test_bot" }),
    });
    expect(plan.ok).toBe(false);
  });
});
