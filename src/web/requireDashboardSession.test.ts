import { describe, expect, it } from "vitest";
import { signSession } from "./sessionCookie.js";
import { resolveCallerFromCookie } from "./requireDashboardSession.js";

/**
 * Shared cookie -> Caller resolution for the Next.js mutation API routes
 * (Phase 6.2, issue #17). Extracted so every mutation Route Handler
 * (`app/api/tasks/**`) can stay a thin adapter instead of re-deriving
 * `verifySession` plumbing five times over — same idea as
 * `telegramLoginHandler.ts` being pulled out from underneath the auth
 * callback route. No authorization decision is made here beyond "is there a
 * valid, unexpired session at all" — role/ownership checks stay entirely in
 * TaskService, same as every other caller of it in this codebase.
 */

const SECRET = "test-session-secret";
const CALLER = { username: "carla", role: "HigherUp" as const, cohortId: "cohort-5" };

describe("resolveCallerFromCookie", () => {
  it("resolves a valid signed cookie to its Caller", () => {
    const cookieValue = signSession(CALLER, SECRET);
    expect(resolveCallerFromCookie(cookieValue, SECRET)).toEqual(CALLER);
  });

  it("returns undefined for an undefined cookie value", () => {
    expect(resolveCallerFromCookie(undefined, SECRET)).toBeUndefined();
  });

  it("returns undefined for a tampered cookie value", () => {
    const cookieValue = signSession(CALLER, SECRET);
    const tampered = cookieValue.slice(0, -1) + (cookieValue.endsWith("a") ? "b" : "a");
    expect(resolveCallerFromCookie(tampered, SECRET)).toBeUndefined();
  });

  it("returns undefined for a cookie signed with a different secret", () => {
    const cookieValue = signSession(CALLER, SECRET);
    expect(resolveCallerFromCookie(cookieValue, "wrong-secret")).toBeUndefined();
  });

  it("returns undefined for an expired cookie", () => {
    const cookieValue = signSession(CALLER, SECRET, { ttlMs: -1 });
    expect(resolveCallerFromCookie(cookieValue, SECRET)).toBeUndefined();
  });
});
