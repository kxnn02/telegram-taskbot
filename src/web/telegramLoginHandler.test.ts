import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Roster } from "../domain/roster.js";
import { verifySession } from "./sessionCookie.js";
import { handleTelegramLoginCallback } from "./telegramLoginHandler.js";
import type { TelegramAuthData } from "./telegramAuth.js";

/**
 * Core logic for the Next.js login callback route (Phase 6.1 / issue #17),
 * framework-independent like webhookHandler.ts — takes a plain query object
 * instead of a real NextRequest, so it's directly unit-testable without
 * booting Next. `app/api/auth/telegram/callback/route.ts` is the thin
 * adapter that calls this and translates the result into a NextResponse.
 */

const BOT_TOKEN = "555555:dashboard-test-token";
const SESSION_SECRET = "dashboard-test-session-secret";
const COHORT = "cohort-5";

function makeRoster() {
  return new Roster([
    { username: "alice", role: "Intern", cohortId: COHORT },
    { username: "carla", role: "HigherUp", cohortId: COHORT },
  ]);
}

function sign(data: Omit<TelegramAuthData, "hash">): TelegramAuthData {
  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  const checkString = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  return { ...data, hash };
}

function telegramQueryFor(username: string, id = 111): Record<string, string> {
  const payload = sign({
    id,
    first_name: "Test",
    username,
    auth_date: Math.floor(Date.now() / 1000),
  });
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
}

function deps(overrides: Partial<{ activeCohortId: string; roster: Roster }> = {}) {
  return {
    botToken: BOT_TOKEN,
    roster: overrides.roster ?? makeRoster(),
    activeCohortId: overrides.activeCohortId ?? COHORT,
    sessionSecret: SESSION_SECRET,
  };
}

describe("handleTelegramLoginCallback", () => {
  it("logs in a higher-up and returns a signed session cookie value", () => {
    const result = handleTelegramLoginCallback(deps(), telegramQueryFor("carla"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.caller).toEqual({ username: "carla", role: "HigherUp", cohortId: COHORT });
    const verified = verifySession(result.cookieValue, SESSION_SECRET);
    expect(verified).toEqual({ ok: true, session: result.caller });
  });

  it("logs in an intern on the roster and returns a signed session cookie value (R6/#91)", () => {
    const result = handleTelegramLoginCallback(deps(), telegramQueryFor("alice"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.caller).toEqual({ username: "alice", role: "Intern", cohortId: COHORT });
    const verified = verifySession(result.cookieValue, SESSION_SECRET);
    expect(verified).toEqual({ ok: true, session: result.caller });
  });

  it("rejects a Telegram account not on the roster at all", () => {
    const result = handleTelegramLoginCallback(deps(), telegramQueryFor("eve_stranger"));
    expect(result).toEqual({
      ok: false,
      message: "Your Telegram account isn't registered on the roster for this cohort.",
    });
  });

  it("rejects a tampered payload", () => {
    const query = telegramQueryFor("carla");
    const tampered = { ...query, username: "carla_but_altered" };
    const result = handleTelegramLoginCallback(deps(), tampered);
    expect(result.ok).toBe(false);
  });

  it("resolves against the dashboard's own bound cohort, not just any matching username (ADR-0004 dry-run reused accounts) — same username is an Intern there and still gets a session", () => {
    const roster = new Roster([
      { username: "carla", role: "HigherUp", cohortId: "cohort-5" },
      { username: "carla", role: "Intern", cohortId: "cohort5-dryrun" },
    ]);
    const result = handleTelegramLoginCallback(
      deps({ roster, activeCohortId: "cohort5-dryrun" }),
      telegramQueryFor("carla"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.caller).toEqual({ username: "carla", role: "Intern", cohortId: "cohort5-dryrun" });
  });

  it("rejects a roster member logging in against a cohort they're not a member of at all, even though the same username exists in another cohort (ADR-0004 dry-run reused accounts / cohort binding)", () => {
    const roster = new Roster([
      { username: "carla", role: "HigherUp", cohortId: "cohort-5" },
      { username: "carla", role: "Intern", cohortId: "cohort5-dryrun" },
    ]);
    const result = handleTelegramLoginCallback(
      deps({ roster, activeCohortId: "cohort-6" }),
      telegramQueryFor("carla"),
    );
    expect(result.ok).toBe(false);
  });
});
