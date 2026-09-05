import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { RosterStorePort } from "../storage/rosterStorePort.js";
import { normalizeUsername, type Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";

export type ResolveResult =
  | { status: "ok"; caller: Caller }
  | { status: "no_username" };

/**
 * Resolves a Telegram sender into a service-layer `Caller`, auto-registering
 * them the first time they're seen (ADR-0013 — matches Devie's `syncMember`,
 * which inserts anyone who messages the bot with no gate of any kind).
 *
 * Every call: links `telegramUserId` to `username` in the registration
 * store (so DMs can reach them later), and upserts a roster row for them in
 * the caller's active cohort (so they show up as a cohort member). Both are
 * plain upserts, so a second message from the same sender updates their
 * linked username in place rather than inserting a duplicate row — there is
 * no separate "already registered" branch to fall into.
 *
 * The one failure case that survives: a Telegram account with no `username`
 * set can't be tracked at all, since both the registration and roster rows
 * are keyed by username.
 */
export async function resolveCaller(
  from: { id: number; username?: string },
  registrations: RegistrationStorePort,
  rosterStore: RosterStorePort,
  roster: Roster,
  cohortId: string,
): Promise<ResolveResult> {
  if (!from.username) return { status: "no_username" };
  const username = normalizeUsername(from.username);

  await registrations.register(from.id, username);

  if (!roster.isMember(username, cohortId)) {
    await rosterStore.upsert({ username, cohortId }, username);
    roster.replaceAll(await rosterStore.listAll());
  }

  return { status: "ok", caller: { username, cohortId } };
}
