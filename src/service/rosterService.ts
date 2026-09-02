import type { RosterStorePort } from "../storage/rosterStorePort.js";
import type { TaskStorePort } from "../storage/taskStorePort.js";
import { normalizeUsername, Roster } from "../domain/roster.js";
import {
  fail,
  ok,
  type Caller,
  type Role,
  type RosterEntry,
  type ServiceResult,
} from "../domain/types.js";
import { OPEN_STATUSES } from "./taskService.js";

function displayName(username: string): string {
  return `@${username}`;
}

/** Refusal used by every operation the authority table (R4/#89) marks as
 * needing a live group-admin check, when the bot layer hands over
 * `verifiedGroupAdmin: false`. The bot layer is expected to have already
 * given the caller a more specific, actionable reason (e.g. the cohort's
 * group chat isn't configured, or they aren't an admin of it) before it
 * ever gets here with `false` — this message is the service's own
 * defense-in-depth refusal for the case where it didn't. */
const GROUP_ADMIN_REQUIRED =
  "That requires being an admin of the cohort's Telegram group.";

/** The rule that a cohort may never reach zero higher-ups (R4/#89) — shared
 * by `setRole`'s demotion guard and `removeMember`'s guard. */
const LAST_HIGHER_UP_ERROR =
  "That would leave the cohort with no higher-ups left — promote someone else first.";

function unknownMember(username: string): string {
  return `${displayName(username)} isn't a known roster member in this cohort.`;
}

/**
 * The roster-management service layer (ticket R4/#89): lets a cohort list,
 * add to, re-role, and shrink its own roster from Telegram (or, later, the
 * dashboard). Mirrors `TaskService`'s conventions — `Caller` as the actor,
 * `ServiceResult<T>` via `ok`/`fail`, usernames normalized through
 * `normalizeUsername` — but lives in its own module since none of this is
 * about tasks (CONTEXT.md's one-seam rule keeps roster rules out of
 * `createBot.ts`).
 *
 * `verifiedGroupAdmin` on `addMember`/`setRole`/`removeMember` is evidence
 * the bot layer gathered from Telegram's `getChatAdministrators` (via
 * `checkGroupAdmin`, R3/#88) — this service can't call Telegram itself. The
 * rule is owned here, not by the bot layer, so every operation the
 * authority table marks as needing it fails whenever that evidence is
 * `false`, no matter how privileged the caller's self-declared roster role
 * is: gating roster *management* on the self-declared roster role would be
 * circular, since an intern who tapped "Higher-up" at /start could
 * otherwise demote everyone above them.
 */
export class RosterService {
  constructor(
    private readonly rosterStore: RosterStorePort,
    private readonly roster: Roster,
    private readonly taskStore: TaskStorePort,
  ) {}

  /** Lists every member of the caller's cohort, sorted by username.
   * Roster-role `HigherUp` only. */
  async listMembers(caller: Caller): Promise<ServiceResult<RosterEntry[]>> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can view the roster.");
    }
    const members = this.membersOf(caller.cohortId).sort((a, b) =>
      a.username.localeCompare(b.username),
    );
    return ok(members);
  }

  /**
   * Adds a new roster member, defaulting to `Intern`. Adding as `Intern`
   * needs roster-role `HigherUp`; adding as `HigherUp` needs the live
   * group-admin check instead (the authority table's point: the caller's
   * self-declared roster role can't be trusted to grant itself peers).
   * Refuses rather than overwriting when the username is already a member —
   * that's what `setRole` is for.
   */
  async addMember(
    caller: Caller,
    username: string,
    role: Role,
    verifiedGroupAdmin: boolean,
  ): Promise<ServiceResult<RosterEntry>> {
    if (role === "HigherUp") {
      if (!verifiedGroupAdmin) return fail(GROUP_ADMIN_REQUIRED);
    } else if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can add roster members.");
    }

    const normalized = normalizeUsername(username);
    if (this.roster.isMember(normalized, caller.cohortId)) {
      return fail(
        `${displayName(normalized)} is already on the roster — use /roster role to change their role.`,
      );
    }

    const entry: RosterEntry = { username: normalized, role, cohortId: caller.cohortId };
    await this.rosterStore.upsert(entry, normalizeUsername(caller.username));
    return ok(entry);
  }

  /**
   * Changes an existing member's role. Always needs the live group-admin
   * check (the authority table lists no self-declared-role alternative for
   * this one), and refuses a demotion that would leave the cohort with zero
   * higher-ups.
   */
  async setRole(
    caller: Caller,
    username: string,
    role: Role,
    verifiedGroupAdmin: boolean,
  ): Promise<ServiceResult<RosterEntry>> {
    if (!verifiedGroupAdmin) return fail(GROUP_ADMIN_REQUIRED);

    const normalized = normalizeUsername(username);
    const existing = this.roster.find(normalized, caller.cohortId);
    if (!existing || existing.cohortId !== caller.cohortId) {
      return fail(unknownMember(normalized));
    }

    const demotingLastHigherUp =
      existing.role === "HigherUp" &&
      role !== "HigherUp" &&
      this.higherUpCount(caller.cohortId) <= 1;
    if (demotingLastHigherUp) {
      return fail(LAST_HIGHER_UP_ERROR);
    }

    const entry: RosterEntry = { username: normalized, role, cohortId: caller.cohortId };
    await this.rosterStore.upsert(entry, normalizeUsername(caller.username));
    return ok(entry);
  }

  /**
   * Removes a member. Always needs the live group-admin check, refuses
   * removing the last higher-up, and refuses removal while the member holds
   * open (non-`done`) tasks — `tasks.assignee_username` has no FK to
   * `roster`, so orphaning those tasks silently breaks several other
   * reads (see the ticket). The failure message names the task refs that
   * need reassigning first.
   */
  async removeMember(
    caller: Caller,
    username: string,
    verifiedGroupAdmin: boolean,
  ): Promise<ServiceResult<void>> {
    if (!verifiedGroupAdmin) return fail(GROUP_ADMIN_REQUIRED);

    const normalized = normalizeUsername(username);
    const existing = this.roster.find(normalized, caller.cohortId);
    if (!existing || existing.cohortId !== caller.cohortId) {
      return fail(unknownMember(normalized));
    }

    if (existing.role === "HigherUp" && this.higherUpCount(caller.cohortId) <= 1) {
      return fail(LAST_HIGHER_UP_ERROR);
    }

    const tasks = await this.taskStore.listTasksByCohort(caller.cohortId);
    const openTasks = tasks.filter(
      (t) => t.assigneeUsername === normalized && OPEN_STATUSES.includes(t.status),
    );
    if (openTasks.length > 0) {
      const refs = openTasks.map((t) => `#${t.id}`).join(", ");
      return fail(
        `${displayName(normalized)} still has open tasks that need reassigning first: ${refs}.`,
      );
    }

    await this.rosterStore.remove(caller.cohortId, normalized);
    return ok(undefined);
  }

  private membersOf(cohortId: string): RosterEntry[] {
    return this.roster.all().filter((e) => e.cohortId === cohortId);
  }

  private higherUpCount(cohortId: string): number {
    return this.membersOf(cohortId).filter((e) => e.role === "HigherUp").length;
  }
}
