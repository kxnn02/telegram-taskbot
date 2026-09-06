import { normalizeUsername } from "../domain/roster.js";
import { fail, ok, type Caller, type ServiceResult } from "../domain/types.js";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { RosterStorePort } from "../storage/rosterStorePort.js";
import { sortMembersByUsername, type TeamMemberRow } from "../web/teamView.js";

function requireNonEmpty(value: string, label: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return `${label} can't be empty.`;
  }
  return undefined;
}

/**
 * The team-page service layer (issue #105 sub-stage 5d), parallel to
 * `TagService`/`SettingsService`: business rules live here, independent of
 * Telegram/HTTP, talking to Supabase only through `RosterStorePort`/
 * `RegistrationStorePort` (ADR-0002/ADR-0006), same as every other service
 * in this codebase.
 *
 * Ports Devie's `app/dashboard/team/page.tsx` (add/edit/remove, no
 * permissions — decisions 3, #92) onto this repo's *existing* roster
 * concept (ADR-0003, extended by ADR-0010, superseded in its access-control
 * half by ADR-0013) rather than a parallel `members` table: a "member" here
 * *is* a roster entry. Devie's `members` row has `name`, `telegram_username`,
 * `telegram_id`, `role`, and `created_at`; this repo's roster row is just
 * `(username, cohort_id)` (see `RosterEntry`) — there is no display name and
 * no role column at all (ticket decision: "No role column — #106 deletes
 * roles"). `telegramId` and `registeredAt` are read-only enrichment pulled
 * from `RegistrationStorePort` (the `registrations` table `/start` already
 * populates) rather than new writable fields, since nothing on this page can
 * make a Telegram id real — only `/start` does that.
 *
 * There is no "edit" of anything but the username itself (no role, no name):
 * `renameMember` corrects a typo or an updated Telegram handle entered before
 * that person has run `/start`. It's implemented as remove-then-upsert since
 * `RosterStorePort`'s primary key is `(cohort_id, username)` itself — there
 * is no synthetic id to update in place through this port.
 */
export class RosterService {
  constructor(
    private readonly rosterStore: RosterStorePort,
    private readonly registrationStore: RegistrationStorePort,
  ) {}

  /** Cohort-scoped list, sorted by username, each entry enriched with its
   * Telegram id and registration timestamp when known. */
  async listMembers(caller: Caller): Promise<ServiceResult<TeamMemberRow[]>> {
    const all = await this.rosterStore.listAll();
    const inCohort = all.filter((entry) => entry.cohortId === caller.cohortId);

    const enriched = await Promise.all(
      inCohort.map(async (entry): Promise<TeamMemberRow> => {
        const [telegramId, registeredAt] = await Promise.all([
          this.registrationStore.findTelegramId(entry.username),
          this.registrationStore.findRegisteredAt(entry.username),
        ]);
        return { username: entry.username, telegramId, registeredAt };
      }),
    );

    return ok(sortMembersByUsername(enriched));
  }

  /** Adds a new roster entry to the caller's cohort. Rejects a duplicate
   * (case-insensitive) rather than silently upserting over it, since a
   * dashboard "Add Member" that quietly no-ops on a typo'd duplicate would
   * be confusing — `renameMember`/`removeMember` are the explicit paths for
   * changing an existing entry. */
  async addMember(caller: Caller, username: string): Promise<ServiceResult<void>> {
    const err = requireNonEmpty(username, "Username");
    if (err) return fail(err);

    const normalized = normalizeUsername(username);
    const all = await this.rosterStore.listAll();
    const exists = all.some(
      (entry) => entry.cohortId === caller.cohortId && normalizeUsername(entry.username) === normalized,
    );
    if (exists) return fail("That member is already on the roster.");

    await this.rosterStore.upsert({ username: normalized, cohortId: caller.cohortId }, caller.username);
    return ok(undefined);
  }

  /** Renames an existing roster entry. No-op success if the new username
   * (after normalization) is the same as the old one. */
  async renameMember(
    caller: Caller,
    oldUsername: string,
    newUsername: string,
  ): Promise<ServiceResult<void>> {
    const err = requireNonEmpty(newUsername, "Username");
    if (err) return fail(err);

    const all = await this.rosterStore.listAll();
    const normalizedOld = normalizeUsername(oldUsername);
    const found = all.find(
      (entry) => entry.cohortId === caller.cohortId && normalizeUsername(entry.username) === normalizedOld,
    );
    if (!found) return fail("Member not found.");

    const normalizedNew = normalizeUsername(newUsername);
    if (normalizedNew === normalizedOld) return ok(undefined);

    const conflict = all.some(
      (entry) => entry.cohortId === caller.cohortId && normalizeUsername(entry.username) === normalizedNew,
    );
    if (conflict) return fail("That username is already on the roster.");

    await this.rosterStore.remove(caller.cohortId, oldUsername);
    await this.rosterStore.upsert({ username: normalizedNew, cohortId: caller.cohortId }, caller.username);
    return ok(undefined);
  }

  /** Removes a roster entry. No-op success if it doesn't exist — matches
   * `RosterStorePort.remove`'s own no-op-if-missing contract, and there is
   * no access-control tier left to make "not found" a distinct outcome from
   * "already gone" (ADR-0013). */
  async removeMember(caller: Caller, username: string): Promise<ServiceResult<void>> {
    await this.rosterStore.remove(caller.cohortId, username);
    return ok(undefined);
  }
}
