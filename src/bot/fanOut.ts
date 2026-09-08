import type { Roster } from "../domain/roster.js";
import { formatTaskRef } from "./taskRef.js";
import { esc } from "./html.js";

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

/** A cohort id and the `@slug` someone types at it are compared with every
 * separator dropped, so `@cohort5` reaches `cohort-5`. This is not
 * cosmetic: `MENTION_RE` (`addTaskParse.ts`) matches `@(\w+)` and `\w`
 * excludes `-`, so `@cohort-5` — the literal id — never parses as a
 * mention at all. Without this, no typeable token names a cohort. */
function canonicalizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
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
  const target = canonicalizeSlug(roleSlug);
  if (target === "") return [];
  return roster
    .all()
    .filter((entry) => canonicalizeSlug(entry.cohortId) === target)
    .map((entry) => entry.username);
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
