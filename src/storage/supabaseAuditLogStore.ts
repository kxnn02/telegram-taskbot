import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLog, AuditLogStatus } from "../domain/types.js";
import type { AuditLogStorePort } from "./auditLogStorePort.js";

interface AuditLogRow {
  id: number;
  cohort_id: string;
  action: string;
  status: AuditLogStatus;
  message: string;
  meta: Record<string, unknown>;
  created_at: string;
}

/** Real `AuditLogStorePort` implementation over the Supabase `audit_logs`
 * table (issue #105 sub-stage 5c), cohort-scoped the same way
 * `SupabaseTagStore` scopes every query.
 *
 * No live Supabase test is included in this worktree — no live credentials
 * available in this sandboxed environment (same caveat as
 * `SupabaseTagStore`'s doc comment); exercised only by typecheck/build. */
export class SupabaseAuditLogStore implements AuditLogStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async insert(
    cohortId: string,
    entry: { action: string; status: AuditLogStatus; message: string; meta?: Record<string, unknown> },
  ): Promise<AuditLog> {
    const { data, error } = await this.client
      .from("audit_logs")
      .insert({
        cohort_id: cohortId,
        action: entry.action,
        status: entry.status,
        message: entry.message,
        meta: entry.meta ?? {},
      })
      .select("id, cohort_id, action, status, message, meta, created_at")
      .single();
    if (error) {
      throw new Error(`insert audit log(${cohortId}, ${entry.action}) failed: ${error.message}`);
    }
    return toAuditLog(data as AuditLogRow);
  }

  async listRecent(cohortId: string, limit: number): Promise<AuditLog[]> {
    const { data, error } = await this.client
      .from("audit_logs")
      .select("id, cohort_id, action, status, message, meta, created_at")
      .eq("cohort_id", cohortId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      throw new Error(`listRecent(${cohortId}) failed: ${error.message}`);
    }
    return ((data ?? []) as AuditLogRow[]).map(toAuditLog);
  }

  /** Keyset pagination by `id` (issue #105 sub-stage 5e's dedicated
   * activity-log view) rather than an offset — cheaper for Postgres and
   * stable under concurrent inserts, since a new row landing between two
   * page fetches can't shift already-seen rows into the next page. Fetches
   * one extra row to derive `hasMore` without a separate count query. */
  async listPage(
    cohortId: string,
    opts: { limit: number; beforeId?: number },
  ): Promise<{ items: AuditLog[]; hasMore: boolean }> {
    let query = this.client
      .from("audit_logs")
      .select("id, cohort_id, action, status, message, meta, created_at")
      .eq("cohort_id", cohortId)
      .order("id", { ascending: false })
      .limit(opts.limit + 1);
    if (opts.beforeId !== undefined) {
      query = query.lt("id", opts.beforeId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`listPage(${cohortId}) failed: ${error.message}`);
    }
    const rows = (data ?? []) as AuditLogRow[];
    const hasMore = rows.length > opts.limit;
    return { items: rows.slice(0, opts.limit).map(toAuditLog), hasMore };
  }
}

function toAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    cohortId: row.cohort_id,
    action: row.action,
    status: row.status,
    message: row.message,
    meta: row.meta,
    createdAt: row.created_at,
  };
}
