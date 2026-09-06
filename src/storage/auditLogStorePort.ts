import type { AuditLog, AuditLogStatus } from "../domain/types.js";

/**
 * Storage port for the `audit_logs` table (issue #101's migration; issue
 * #105 sub-stage 5c is the first writer/reader). Cohort-scoped, same
 * seam pattern as `TagStorePort`/`TaskStorePort` (ADR-0002/ADR-0006).
 */
export interface AuditLogStorePort {
  /** Inserts a new row and returns it (with its generated `id`/`createdAt`)
   * — mirrors Devie's `addAuditLog` (`app/dashboard/settings/page.tsx:136-144`),
   * minus the client-side refetch, which happens in `SettingsService`
   * instead. `meta` defaults to `{}` (Devie's own literal). */
  insert(
    cohortId: string,
    entry: { action: string; status: AuditLogStatus; message: string; meta?: Record<string, unknown> },
  ): Promise<AuditLog>;

  /** Most recent rows for a cohort, newest first — mirrors Devie's
   * `fetchAuditLogs` (`:126-134`: `.order('created_at', { ascending: false
   * }).limit(50)`). */
  listRecent(cohortId: string, limit: number): Promise<AuditLog[]>;

  /** Keyset-paginated rows for a cohort, newest first, for the dedicated
   * activity-log view (issue #105 sub-stage 5e) — `listRecent` is enough
   * for the settings page's inline preview, but a standalone view over a
   * table that only ever grows needs pagination rather than one capped
   * `limit`. `beforeId` (when given) returns rows with `id` strictly less
   * than it — ids are a Postgres `bigserial`, monotonic with insertion
   * order, so this is a stable cursor even when two rows share the same
   * millisecond `created_at`. `hasMore` tells the caller whether another
   * page exists past the one returned. */
  listPage(cohortId: string, opts: { limit: number; beforeId?: number }): Promise<{ items: AuditLog[]; hasMore: boolean }>;
}
