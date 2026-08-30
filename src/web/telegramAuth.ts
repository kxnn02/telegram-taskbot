import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Payload Telegram sends to the Login Widget's callback/redirect URL.
 * https://core.telegram.org/widgets/login
 */
export interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number; // unix seconds
  hash: string;
}

export type TelegramAuthResult =
  | { ok: true; username: string }
  | { ok: false; error: string };

const MAX_AUTH_AGE_SECONDS = 86_400; // 24h — Telegram's own recommended window

/**
 * Verifies a Telegram Login Widget payload per Telegram's documented
 * algorithm: the bot token's SHA-256 digest is used as an HMAC key over the
 * sorted "key=value" fields (excluding "hash" itself), and the result must
 * match the "hash" field the widget supplied. This is the entirety of
 * "Telegram login" auth for the dashboard (PRD §9) — no separate password
 * system, no session state beyond what this check produces.
 */
export function verifyTelegramAuth(
  data: TelegramAuthData,
  botToken: string,
  maxAgeSeconds = MAX_AUTH_AGE_SECONDS,
): TelegramAuthResult {
  const { hash, ...rest } = data;
  if (!hash) {
    return { ok: false, error: "Missing signature." };
  }

  const secretKey = createHash("sha256").update(botToken).digest();
  const checkString = Object.entries(rest)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");
  const expectedHash = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (!safeHexEqual(expectedHash, hash)) {
    return { ok: false, error: "Invalid Telegram login signature." };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - data.auth_date > maxAgeSeconds) {
    return { ok: false, error: "Login expired — please log in again." };
  }

  if (!data.username) {
    return {
      ok: false,
      error:
        "Your Telegram account has no username set — add one in Telegram settings to log in.",
    };
  }

  return { ok: true, username: data.username };
}

function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
