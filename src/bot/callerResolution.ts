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
 * this returns a specific status rather than throwing. */
export async function resolveCaller(
  telegramUserId: number,
  registrations: RegistrationStorePort,
  roster: Roster,
): Promise<ResolveResult> {
  const username = await registrations.findUsername(telegramUserId);
  if (!username) return { status: "not_started" };

  const entry = roster.find(username);
  if (!entry) return { status: "not_on_roster" };

  return {
    status: "ok",
    caller: { username: entry.username, role: entry.role, cohortId: entry.cohortId },
  };
}
