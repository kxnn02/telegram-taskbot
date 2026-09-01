import type { Caller } from "../domain/types.js";
import { verifySession } from "./sessionCookie.js";

/**
 * Shared cookie -> Caller resolution for the Next.js dashboard's mutation
 * API routes (Phase 6.2, issue #17). Every mutation Route Handler
 * (`app/api/tasks/**`) calls this instead of re-deriving the same
 * `verifySession` plumbing already used by `app/page.tsx` and
 * the removed Express dashboard's `getCaller` — kept here as a plain, framework-
 * independent function (a cookie string in, a `Caller | undefined` out) so
 * it's directly unit-testable without booting Next. This resolves *whether
 * there's a valid session at all*, nothing more — role/ownership
 * authorization for a specific action stays entirely in `TaskService`,
 * exactly as it does for every other caller of it in this codebase.
 */
export const SESSION_COOKIE = "session";

export function resolveCallerFromCookie(
  cookieValue: string | undefined,
  sessionSecret: string,
): Caller | undefined {
  if (!cookieValue) return undefined;
  const result = verifySession(cookieValue, sessionSecret);
  return result.ok ? result.session : undefined;
}
