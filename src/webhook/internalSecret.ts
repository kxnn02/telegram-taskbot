import { timingSafeEqual } from "node:crypto";

/**
 * Shared internal-secret verification utility (ADR-0007's "one shared
 * internal-secret header" decision): extracted from the webhook's original
 * inline `secretMatches` so the same timing-safe comparison backs every
 * machine-to-machine call in this system — the Telegram webhook's
 * `X-Telegram-Bot-Api-Secret-Token` check, the `/api/jobs/*` endpoints'
 * internal-job-secret check, and (per platform constraint, see
 * `src/jobs/jobAuth.ts`) the Vercel-Cron-triggered endpoints' bearer-token
 * check — rather than each call site reinventing its own comparison.
 */

/**
 * Timing-safe comparison of an incoming secret header/token against the
 * expected value. A plain `===` here would leak a timing side-channel on a
 * secret check; `crypto.timingSafeEqual` requires equal-length buffers, so a
 * length mismatch (including a missing header) is treated as a non-match up
 * front without ever touching `timingSafeEqual`.
 */
export function secretMatches(candidate: string | undefined, expected: string): boolean {
  if (candidate === undefined) return false;
  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expected);
  if (candidateBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(candidateBuf, expectedBuf);
}

/** Reads a header value out of a plain header map, taking the first entry
 * when a header was sent multiple times (Node's `IncomingMessage.headers`
 * shape represents that case as an array). */
export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}
