import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";

export type ResolveResult =
  | { status: "ok"; caller: Caller }
  | { status: "not_started" }
  | { status: "not_on_roster" };

/** Resolves a Telegram user id to a service-layer Caller by looking up the
 * username they registered with (PRD §7) against the current roster. If
 * they've never run /start, or their roster entry has since been removed,
 * this returns a specific status rather than throwing.
 *
 * `cohortId` is the cohort this deployment is bound to (ADR-0004's dry-run
 * design: the real cohort and the dry-run cohort can share the same real
 * Telegram accounts, e.g. `kxnn02` exists as HigherUp under both). Every
 * live deployment only ever serves one cohort, so this is always passed
 * explicitly by production callers — `roster.find` is never allowed to
 * fall back to its ambiguous no-cohort-arg overload for a real request,
 * which would otherwise silently resolve to whichever cohort happens to
 * be first in roster order, not necessarily the one this deployment is
 * actually serving. See CONTEXT.md's cohort-binding note for the incident
 * this closes.
 */
export async function resolveCaller(
  telegramUserId: number,
  registrations: RegistrationStorePort,
  roster: Roster,
  cohortId: string,
): Promise<ResolveResult> {
  const username = await registrations.findUsername(telegramUserId);
  if (!username) return { status: "not_started" };

  const entry = roster.find(username, cohortId);
  if (!entry) return { status: "not_on_roster" };

  return {
    status: "ok",
    caller: { username: entry.username, role: entry.role, cohortId: entry.cohortId },
  };
}
