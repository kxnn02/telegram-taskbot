import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { verifyTelegramAuth, type TelegramAuthData } from "./telegramAuth.js";
import { signSession } from "./sessionCookie.js";

/**
 * Core logic behind the Telegram Login Widget's server-side callback
 * (CONTEXT.md's "Dashboard: Telegram Login Widget" section, ADR-0008),
 * ported for the Next.js rewrite (Phase 6.1 / issue #17). Deliberately
 * framework-independent — takes a plain query-string-shaped object instead
 * of a real `NextRequest`, mirroring `webhookHandler.ts`'s split between
 * pure logic and a thin adapter — so it's directly unit-testable and so the
 * exact same logic that already runs in the Express dashboard
 * (`dashboardServer.ts`'s `/auth/telegram/callback` route) is reproduced
 * here rather than re-derived. `dashboardServer.ts` itself is untouched;
 * this is a new, separate copy for the new stack.
 */
export interface TelegramLoginDeps {
  botToken: string;
  roster: Roster;
  /** The cohort this deployed dashboard instance serves (ADR-0004) — the
   * roster lookup below is always bound to this id, same reasoning as
   * `dashboardServer.ts`'s `activeCohortId`. */
  activeCohortId: string;
  /** Secret used to sign the stateless session cookie (ADR-0008). */
  sessionSecret: string;
}

export type TelegramLoginResult =
  | { ok: true; cookieValue: string; caller: Caller }
  | { ok: false; message: string };

/** A single incoming query value, the shape both Express's `req.query` and
 * Next's `URLSearchParams`-derived plain objects produce. */
export type QueryValue = string | string[] | undefined;

export function handleTelegramLoginCallback(
  deps: TelegramLoginDeps,
  query: Record<string, QueryValue>,
): TelegramLoginResult {
  const data = toTelegramAuthData(query);
  const verified = verifyTelegramAuth(data, deps.botToken);
  if (!verified.ok) {
    return { ok: false, message: verified.error };
  }

  const entry = deps.roster.find(verified.username, deps.activeCohortId);
  if (!entry || entry.role !== "HigherUp") {
    return {
      ok: false,
      message:
        "This dashboard is for higher-ups only. Your Telegram account isn't registered as a higher-up for this cohort.",
    };
  }

  const caller: Caller = { username: entry.username, role: entry.role, cohortId: entry.cohortId };
  const cookieValue = signSession(caller, deps.sessionSecret);
  return { ok: true, cookieValue, caller };
}

function first(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toTelegramAuthData(query: Record<string, QueryValue>): TelegramAuthData {
  // Telegram's widget sends every field as a query-string value (i.e. a
  // string), including `id` and `auth_date` which TelegramAuthData types as
  // `number` — verifyTelegramAuth only ever uses them in arithmetic/HMAC
  // string-building, both of which coerce a numeric string correctly, so no
  // explicit Number() conversion is needed here (matches the existing
  // Express route's `req.query as unknown as TelegramAuthData` cast).
  return {
    id: first(query.id) as unknown as number,
    first_name: first(query.first_name) ?? "",
    last_name: first(query.last_name),
    username: first(query.username),
    photo_url: first(query.photo_url),
    auth_date: first(query.auth_date) as unknown as number,
    hash: first(query.hash) ?? "",
  };
}
