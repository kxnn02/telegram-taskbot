import type { AuditLogStatus } from "../domain/types.js";

/**
 * Pure view-formatting for the settings page's inline activity log (issue
 * #105 sub-stage 5c) — ports DevieBot's `formatAuditTime`/status-glyph
 * inline logic (`app/dashboard/settings/page.tsx:146-150,542-547`) as
 * standalone, unit-tested functions rather than leaving them as closures
 * inside the React component, per this repo's `src/web/*.ts`
 * view-builder convention.
 */

/** Same rendering Devie uses (`toLocaleTimeString('en-PH', { timeZone:
 * 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' })`)
 * — Asia/Manila is UTC+8 year-round (no DST), matching the convention
 * already used elsewhere in this codebase (see the notification-job cron
 * migration's UTC conversion notes). */
export function formatAuditTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Devie's inline glyph mapping (`entry.status === 'ok' ? '✓' : entry.status
 * === 'error' ? '✗' : '·'`), ported verbatim. */
export function statusGlyph(status: AuditLogStatus): string {
  if (status === "ok") return "✓";
  if (status === "error") return "✗";
  return "·";
}
