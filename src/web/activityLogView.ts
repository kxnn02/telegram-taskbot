import type { AuditLog } from "../domain/types.js";

/**
 * Pure view logic for the dedicated activity-log page (issue #105
 * sub-stage 5e), following this repo's `src/web/*.ts` view-builder
 * convention (unit-tested, no I/O) — mirrors `auditLogView.ts`/
 * `teamView.ts`'s split from their respective services.
 *
 * `auditLogView.ts` (shipped in 5c) covers everything the settings page's
 * inline, capped-at-50 activity list needs: per-row time and status glyph.
 * The dedicated view fetches a paginated feed (`ActivityLogService.listPage`)
 * and needs one thing the inline list never did — grouping by calendar day,
 * so a long, paged-through history reads like a timeline rather than one
 * undifferentiated list. Reuses `formatAuditTime`/`statusGlyph` as-is rather
 * than duplicating them.
 */

/** Same Asia/Manila convention as `auditLogView.ts`'s `formatAuditTime` —
 * Asia/Manila is UTC+8 year-round (no DST). Renders a calendar-day label
 * like `"Aug 31, 2026"` for a group header. */
export function formatAuditDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface ActivityLogDayGroup {
  dateLabel: string;
  entries: AuditLog[];
}

/**
 * Groups a (newest-first) page of audit rows into consecutive day buckets,
 * keyed by their Manila calendar date. Entries are never re-sorted — the
 * caller (`ActivityLogService.listPage`/`SupabaseAuditLogStore.listPage`)
 * already returns them newest-first, and a stable grouping over
 * already-ordered input only ever needs to notice when the date *changes*,
 * not re-derive an order. Two groups with the same date label that aren't
 * adjacent (e.g. a paginated fetch straddling a day boundary twice, which
 * can't happen with a single ascending/descending feed but is still cheap
 * to keep correct) are kept as separate groups rather than merged, so
 * insertion order is never violated.
 */
export function groupAuditLogsByDay(entries: AuditLog[]): ActivityLogDayGroup[] {
  const groups: ActivityLogDayGroup[] = [];
  for (const entry of entries) {
    const dateLabel = formatAuditDate(entry.createdAt);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.dateLabel === dateLabel) {
      currentGroup.entries.push(entry);
    } else {
      groups.push({ dateLabel, entries: [entry] });
    }
  }
  return groups;
}
