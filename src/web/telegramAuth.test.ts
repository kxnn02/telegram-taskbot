import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramAuth, type TelegramAuthData } from "./telegramAuth.js";

const BOT_TOKEN = "123456:ABC-test-token";

/** Signs a payload exactly the way Telegram does for the Login Widget, so
 * tests can construct valid callback data without hitting real Telegram
 * infrastructure. https://core.telegram.org/widgets/login#checking-authorization */
function sign(data: Omit<TelegramAuthData, "hash">, botToken: string): TelegramAuthData {
  const secretKey = createHash("sha256").update(botToken).digest();
  const checkString = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  return { ...data, hash };
}

function freshPayload(overrides: Partial<TelegramAuthData> = {}) {
  const base = {
    id: 987654321,
    first_name: "Carla",
    username: "carla",
    auth_date: Math.floor(Date.now() / 1000),
  };
  return sign({ ...base, ...overrides }, BOT_TOKEN);
}

describe("verifyTelegramAuth", () => {
  it("accepts a correctly-signed, fresh payload", () => {
    const payload = freshPayload();
    const result = verifyTelegramAuth(payload, BOT_TOKEN);
    expect(result).toEqual({ ok: true, username: "carla" });
  });

  it("rejects a payload with a tampered hash", () => {
    const payload = freshPayload();
    const tampered = { ...payload, hash: "0".repeat(64) };
    const result = verifyTelegramAuth(tampered, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload where a field was altered after signing", () => {
    const payload = freshPayload();
    const tampered = { ...payload, username: "eve" };
    const result = verifyTelegramAuth(tampered, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it("rejects a stale auth_date beyond the max age window", () => {
    const staleSeconds = Math.floor(Date.now() / 1000) - 90000; // > 24h old
    const payload = freshPayload({ auth_date: staleSeconds });
    const result = verifyTelegramAuth(payload, BOT_TOKEN);
    expect(result).toEqual({ ok: false, error: "Login expired — please log in again." });
  });

  it("rejects a payload with no username (Telegram accounts can omit one)", () => {
    const payload = sign(
      { id: 1, first_name: "NoHandle", auth_date: Math.floor(Date.now() / 1000) },
      BOT_TOKEN,
    );
    const result = verifyTelegramAuth(payload, BOT_TOKEN);
    expect(result).toEqual({
      ok: false,
      error: "Your Telegram account has no username set — add one in Telegram settings to log in.",
    });
  });

  it("rejects when signed with the wrong bot token", () => {
    const payload = freshPayload();
    const result = verifyTelegramAuth(payload, "999999:WRONG-token");
    expect(result.ok).toBe(false);
  });
});
