/**
 * Pure view logic for the dashboard's team page (issue #105 sub-stage 5d),
 * following this repo's `src/web/*.ts` view-builder convention (unit-tested,
 * no I/O) — mirrors `auditLogView.ts`'s split from `SettingsService`.
 *
 * Devie's stats row (`app/dashboard/team/page.tsx`'s `newThisWeek`/
 * `newThisMonth`) is keyed off `members.created_at`, a real column on their
 * `members` table. This repo's roster has no such column (ADR-0003/
 * ADR-0013 — a roster row is just `(username, cohort_id)`); the closest
 * analog is `registrations.registered_at`, written the one time a person
 * actually runs `/start` in Telegram. A member added on the dashboard but
 * who hasn't yet messaged the bot has no `registeredAt` and is deliberately
 * excluded from both "new" counts — counted only in the total.
 */

export interface TeamMemberRow {
  username: string;
  telegramId?: number;
  registeredAt?: string;
}

export interface TeamStats {
  total: number;
  newThisWeek: number;
  newThisMonth: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Ports Devie's inline stat math (`startOfWeek`/`startOfMonth`, `:26-30`)
 * as a standalone, unit-tested function. `now` is a parameter (not
 * `new Date()`) so this stays pure and testable, same convention as
 * `Clock`-based code elsewhere in this repo. */
export function buildTeamStats(members: TeamMemberRow[], now: Date): TeamStats {
  const startOfWeek = new Date(now.getTime() - 7 * MS_PER_DAY);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  let newThisWeek = 0;
  let newThisMonth = 0;
  for (const member of members) {
    if (!member.registeredAt) continue;
    const registeredAt = new Date(member.registeredAt);
    if (registeredAt >= startOfWeek) newThisWeek++;
    if (registeredAt >= startOfMonth) newThisMonth++;
  }

  return { total: members.length, newThisWeek, newThisMonth };
}

/** Devie groups by role; this repo has none (#106/ADR-0013), so the flat
 * replacement is a single list sorted alphabetically by username —
 * deterministic and stable across reloads. */
export function sortMembersByUsername<T extends { username: string }>(members: T[]): T[] {
  return [...members].sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: "base" }),
  );
}
