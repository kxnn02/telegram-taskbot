/**
 * Per-intern task counts for the daily group-chat summary. Deliberately
 * counts-only — no task id, title, description, or note text belongs in
 * this shape at all, so it's structurally impossible for the group summary
 * formatter below to leak task detail (PRD §8's daily-standup group-summary
 * privacy reasoning, restated in issue #2: this restraint is deliberate,
 * independent of the bot's read-access level).
 */
export interface InternDailyCounts {
  username: string;
  onTrack: number;
  overdue: number;
  blocked: number;
}

/**
 * Formats the single daily group-chat message: aggregate counts across the
 * whole cohort, plus one short status line per intern. Never includes task
 * titles/descriptions/notes — see `InternDailyCounts` above.
 */
export function formatGroupDailySummary(perIntern: InternDailyCounts[]): string {
  if (perIntern.length === 0) {
    return "Nothing to report today — the cohort has no open tasks.";
  }

  const totals = perIntern.reduce(
    (acc, i) => ({
      onTrack: acc.onTrack + i.onTrack,
      overdue: acc.overdue + i.overdue,
      blocked: acc.blocked + i.blocked,
    }),
    { onTrack: 0, overdue: 0, blocked: 0 },
  );

  const header = `${totals.onTrack} on track, ${totals.overdue} overdue, ${totals.blocked} blocked`;

  const lines = perIntern.map((i) => {
    if (i.onTrack === 0 && i.overdue === 0 && i.blocked === 0) {
      return `@${i.username}: no open tasks`;
    }
    const parts: string[] = [];
    if (i.overdue > 0) parts.push(`${i.overdue} overdue`);
    if (i.blocked > 0) parts.push(`${i.blocked} blocked`);
    if (parts.length === 0) {
      return `@${i.username}: on track`;
    }
    return `@${i.username}: ${parts.join(", ")}`;
  });

  return [header, ...lines].join("\n");
}
