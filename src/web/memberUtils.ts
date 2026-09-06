/**
 * Port of DevieBot's `lib/member-utils.ts` @ `632a22c` (issue #105 sub-stage
 * 5b) — verbatim logic and 12-hex `COLORS` array, adapted to this repo's
 * `Member` shape. DevieBot's `Member` comes from a real `members` table with
 * a numeric `id`, a numeric-ish `telegram_id`, an optional `name`, and an
 * optional `telegram_username`; this repo has no such table (only
 * `roster.username`/`cohort_id`), so a `Member` here is a small ad-hoc shape
 * built by callers (e.g. `{ id: assigneeUsername, username: assigneeUsername }`)
 * rather than a real row.
 */
export interface Member {
  id: string | number;
  telegramId?: string | number | null;
  username?: string | null;
  name?: string | null;
}

const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#06b6d4",
  "#64748b",
  "#a855f7",
];

/** Deterministic color derived from `telegramId` or `id` — verbatim port of
 * Devie's `memberColor`, plus one deliberate adaptation: Devie's `id` is
 * always a real numeric database id, so `member.id` alone is a safe integer
 * seed there. This repo's `id` isn't guaranteed numeric (it may be a
 * username, per the doc comment above), so `Number(id)` is used instead of
 * a raw `id`, and falls back to `0` if that's `NaN` — a defensive addition
 * beyond Devie's own code, needed so this function never throws regardless
 * of what shape of `id` a caller passes in. */
export function memberColor(member: Member): string {
  let seed: number;
  if (member.telegramId) {
    seed = parseInt(String(member.telegramId), 10);
  } else {
    const numericId = Number(member.id);
    seed = Number.isNaN(numericId) ? 0 : numericId;
  }
  if (Number.isNaN(seed)) seed = 0;
  return COLORS[Math.abs(seed) % COLORS.length]!;
}

/** Full display label — name preferred, falls back to @username, then
 * #telegramId, then a bare "Member <id>" label. Verbatim port of Devie's
 * `memberLabel`. */
export function memberLabel(member: Member): string {
  if (member.name) return member.name;
  if (member.username) return `@${member.username}`;
  if (member.telegramId) return `#${member.telegramId}`;
  return `Member ${member.id}`;
}

/** Short label for pill/badge display — first name only when possible.
 * Verbatim port of Devie's `memberShortLabel`. */
export function memberShortLabel(member: Member): string {
  if (member.name) return member.name.split(" ")[0]!;
  return String(member.username ?? member.telegramId ?? member.id);
}

/** Avatar initials (1-2 chars). Verbatim port of Devie's `memberInitials`. */
export function memberInitials(member: Member): string {
  if (member.name) {
    const parts = member.name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return parts[0]![0]!.toUpperCase();
  }
  const fallback = member.username?.[0] ?? String(member.telegramId ?? "")[0] ?? "?";
  return fallback.toUpperCase();
}
