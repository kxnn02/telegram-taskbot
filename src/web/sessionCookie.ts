import { createHmac, timingSafeEqual } from "node:crypto";
import type { Caller } from "../domain/types.js";

export interface SessionCookieOptions {
  /** How long a signed session stays valid, in ms. Default 12h — a
   * dashboard login session, not a long-lived "remember me". Mirrors
   * SessionStore's former DEFAULT_TTL_MS. */
  ttlMs?: number;
  /** Injectable clock for tests; defaults to Date.now. */
  clock?: () => number;
}

export type SessionVerifyResult =
  | { ok: true; session: Caller }
  | { ok: false; reason: "invalid" | "expired" };

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

interface SignedPayload extends Caller {
  exp: number;
}

/**
 * Signs a session (username/role/cohortId) into a stateless cookie value:
 * base64url-encoded JSON payload (including an embedded expiry timestamp),
 * a "." separator, then a hex HMAC-SHA256 signature over the encoded
 * payload — the same HMAC-signing style already used and tested for the
 * Telegram Login Widget in telegramAuth.ts, just with its own secret and
 * without needing Telegram's specific checkString format. No server-side
 * state: the whole session lives inside the cookie itself.
 */
export function signSession(caller: Caller, secret: string, options: SessionCookieOptions = {}): string {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const clock = options.clock ?? Date.now;
  const payload: SignedPayload = { ...caller, exp: clock() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

/**
 * Verifies a cookie value produced by signSession: checks the HMAC
 * signature with a timing-safe comparison (mirroring telegramAuth.ts's
 * safeHexEqual), then checks the embedded expiry. Never throws — a
 * malformed/garbage cookie value is reported as `{ ok: false, reason:
 * "invalid" }` rather than propagating a parse error.
 */
export function verifySession(
  cookieValue: string,
  secret: string,
  options: SessionCookieOptions = {},
): SessionVerifyResult {
  const clock = options.clock ?? Date.now;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [encoded, signature] = parts as [string, string];

  const expectedSignature = createHmac("sha256", secret).update(encoded).digest("hex");
  if (!safeHexEqual(expectedSignature, signature)) {
    return { ok: false, reason: "invalid" };
  }

  let payload: SignedPayload;
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    payload = JSON.parse(decoded) as SignedPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.username !== "string" ||
    typeof payload.cohortId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (clock() >= payload.exp) {
    return { ok: false, reason: "expired" };
  }

  const { username, cohortId } = payload;
  return { ok: true, session: { username, cohortId } };
}

function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
