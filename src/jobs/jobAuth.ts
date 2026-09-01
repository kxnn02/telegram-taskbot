import { headerValue, secretMatches } from "../webhook/internalSecret.js";

/**
 * Authentication for `/api/jobs/*` endpoints (ADR-0007). Two distinct
 * schemes, both built on the same timing-safe `secretMatches` utility the
 * webhook uses — not one identical header/scheme reused verbatim across all
 * six jobs, despite ADR-0007's "one shared internal-secret header" phrasing,
 * because of a real platform constraint documented at each function below.
 */

/** Header used by the four `pg_net`-triggered notification-job endpoints
 * (overdue-crossing, due-soon reminder, daily digest, weekly digest). We
 * control the headers `pg_net`'s `net.http_post` sends (see the pg_cron
 * migration), so these get a custom header, matching the webhook's
 * `X-Telegram-Bot-Api-Secret-Token` pattern as closely as an internal caller
 * can. */
const INTERNAL_JOB_SECRET_HEADER = "x-internal-job-secret";

export function verifyInternalJobSecret(
  headers: Record<string, string | string[] | undefined>,
  expectedSecret: string,
): boolean {
  return secretMatches(headerValue(headers, INTERNAL_JOB_SECRET_HEADER), expectedSecret);
}

/**
 * Verification for the two Vercel-Cron-triggered endpoints (`keep-alive`,
 * `weekly-backup`). Vercel Cron cannot be configured with a custom header —
 * `vercel.json`'s `crons` entries take only a `path` and `schedule` — so
 * these instead rely on Vercel's own built-in convention: when a `CRON_SECRET`
 * env var is set, Vercel automatically sends
 * `Authorization: Bearer <CRON_SECRET>` on its own cron-triggered requests.
 * This is a deliberate, documented deviation from a literal one-header
 * reused everywhere: the *verification mechanism* (timing-safe compare via
 * `secretMatches`) is shared, but the header/scheme differs because the
 * calling platform (Vercel Cron vs. our own `pg_net` call) differs.
 */
export function verifyCronSecret(
  headers: Record<string, string | string[] | undefined>,
  expectedSecret: string,
): boolean {
  const raw = headerValue(headers, "authorization");
  if (raw === undefined || !raw.startsWith("Bearer ")) return false;
  return secretMatches(raw.slice("Bearer ".length), expectedSecret);
}
