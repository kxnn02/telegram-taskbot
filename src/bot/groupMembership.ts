import type { ChatMember } from "@grammyjs/types/manage.js";

/**
 * Result of checking whether a Telegram user belongs to a cohort's group.
 * Three outcomes, not two: a bare boolean would either open a hole
 * (treating "we couldn't check" as "present") or a lockout (treating it as
 * "absent") — see `checkGroupMembership`'s doc comment.
 *
 * Only used by `src/jobs/rosterReconciliation.ts` (ADR-0013 removed this
 * module's other use, the `/start`/`/roster` access-control checks, along
 * with the group-admin variant `checkGroupAdmin` that only they called).
 */
export type GroupCheck =
  | { kind: "present" }
  | { kind: "absent" }
  | { kind: "unavailable"; reason: string };

/** Narrow slice of grammy's api this module needs for a membership check —
 * matching how `src/webhook/webhookHandler.ts` defines `UpdateHandler`, so
 * this is unit-testable with a plain object and no network. */
export interface MembershipApi {
  getChatMember(chatId: number | string, userId: number): Promise<ChatMember>;
}

/**
 * Checks whether `userId` is currently a member of the cohort's Telegram
 * group. There is no Bot API method to list a group's members
 * (`getChatAdministrators` returns admins only), so this checks one user at
 * a time via `getChatMember`.
 *
 * Returns `unavailable` — never `absent` — when the check couldn't be
 * performed at all (no group configured, or the API call threw). Collapsing
 * "couldn't check" into `absent` would lock out real members whenever the
 * group isn't configured or Telegram is briefly unreachable; collapsing it
 * into `present` would let anyone register. Callers decide how to handle
 * `unavailable` for their own safety requirements.
 */
export async function checkGroupMembership(
  api: MembershipApi,
  groupChatId: string | undefined | null,
  userId: number,
): Promise<GroupCheck> {
  if (groupChatId === undefined || groupChatId === null) {
    return { kind: "unavailable", reason: "no group configured" };
  }

  let member: ChatMember;
  try {
    member = await api.getChatMember(groupChatId, userId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "unavailable", reason };
  }

  if (member.status === "restricted") {
    return member.is_member ? { kind: "present" } : { kind: "absent" };
  }
  if (member.status === "creator" || member.status === "administrator" || member.status === "member") {
    return { kind: "present" };
  }
  // "left" or "kicked"
  return { kind: "absent" };
}
