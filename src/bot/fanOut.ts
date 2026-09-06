import type { Roster } from "../domain/roster.js";
import { formatTaskRef } from "./taskRef.js";

/**
 * Devie's `@all`/role-slug fan-out for the *single*-mention `/addtask`
 * grammar (`app/api/telegram/webhook/route.ts:1201-1269` @ `632a22c`) —
 * checked ahead of the ordinary "isn't a known roster member" rejection, so
 * `@all` and a cohort-id token create one task per member instead of
 * erroring. Distinct from the bulk-paste path (`bulkTaskCreate.ts`): Devie
 * never fans these out inside its bulk insert either, only here.
 */

/** Devie's `@all` (`route.ts:1202-1210`): every roster member in the
 * caller's own cohort. */
export function resolveAllMembers(roster: Roster, cohortId: string): string[] {
  return roster
    .all()
    .filter((entry) => entry.cohortId === cohortId)
    .map((entry) => entry.username);
}

/**
 * Devie's `resolveRoleMembers` (`route.ts:475-484`): every member whose
 * `role` matches `roleSlug`, case-insensitive. Issue #103 item 2 already
 * established this repo's stand-in for Devie's `role` field is `cohort_id`
 * (every roster entry's "role" is just the cohort it belongs to), so this
 * ports the same fan-out onto `cohortId` — a slug matching a cohort id fans
 * out to every member of that cohort.
 */
export function resolveRoleMembers(roster: Roster, roleSlug: string): string[] {
  const target = roleSlug.trim().toLowerCase();
  return roster
    .all()
    .filter((entry) => entry.cohortId.toLowerCase() === target)
    .map((entry) => entry.username);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function memberList(members: string[]): string {
  return members.map((m) => `• @${esc(m)}`).join("\n");
}

/** Devie's "no members at all" reply for `@all` (`route.ts:1207-1209`),
 * copied verbatim. Devie's role branch has no equivalent: an unmatched role
 * slug simply falls through to the ordinary single-member lookup instead of
 * erroring (`resolveRoleMembers`'s caller only takes this branch when the
 * list is non-empty). */
export const NO_MEMBERS_TO_ASSIGN_REPLY = "❌ No members found to assign to.";

/** Devie's `@all` confirmation (`route.ts:1226-1232`), wording and emoji
 * copied verbatim — sent with `parse_mode: "HTML"`. */
export function formatAllAssignedReply(members: string[], title: string): string {
  return (
    `✅ Task assigned to all <b>${members.length}</b> member${members.length !== 1 ? "s" : ""}\n\n` +
    `📝 <b>${esc(title)}</b>\n${memberList(members)}\n\n` +
    `<i>Refresh the dashboard to see the changes.</i>`
  );
}

/** Devie's role/cohort fan-out confirmation (`route.ts:1262-1266`), wording
 * and emoji copied verbatim — `firstCreatedId` names the first task created
 * in the fan-out, matching Devie's `created[0]?.task_number` ellipsis. */
export function formatRoleAssignedReply(
  members: string[],
  title: string,
  roleSlug: string,
  firstCreatedId: number,
): string {
  return (
    `✅ Task assigned to <b>${members.length}</b> member${members.length !== 1 ? "s" : ""} in <b>${esc(roleSlug)}</b> · <code>${formatTaskRefEllipsis(firstCreatedId)}</code>\n\n` +
    `📝 <b>${esc(title)}</b>\n${memberList(members)}\n\n` +
    `<i>Refresh the dashboard to see the changes.</i>`
  );
}

function formatTaskRefEllipsis(firstCreatedId: number): string {
  return `${formatTaskRef(firstCreatedId)}…`;
}
