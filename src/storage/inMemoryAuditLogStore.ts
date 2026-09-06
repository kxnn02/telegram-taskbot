import type { AuditLog, AuditLogStatus } from "../domain/types.js";
import type { AuditLogStorePort } from "./auditLogStorePort.js";

/** In-memory `AuditLogStorePort` implementation (mirrors `InMemoryTagStore`'s
 * shape/conventions) — used by tests, never by production wiring. */
export class InMemoryAuditLogStore implements AuditLogStorePort {
  private readonly rows: AuditLog[] = [];
  private nextId = 1;

  async insert(
    cohortId: string,
    entry: { action: string; status: AuditLogStatus; message: string; meta?: Record<string, unknown> },
  ): Promise<AuditLog> {
    const row: AuditLog = {
      id: this.nextId++,
      cohortId,
      action: entry.action,
      status: entry.status,
      message: entry.message,
      meta: entry.meta ?? {},
      createdAt: new Date().toISOString(),
    };
    this.rows.push(row);
    return { ...row };
  }

  async listRecent(cohortId: string, limit: number): Promise<AuditLog[]> {
    return this.rows
      .filter((r) => r.cohortId === cohortId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async listPage(
    cohortId: string,
    opts: { limit: number; beforeId?: number },
  ): Promise<{ items: AuditLog[]; hasMore: boolean }> {
    const sorted = this.rows
      .filter((r) => r.cohortId === cohortId)
      .filter((r) => opts.beforeId === undefined || r.id < opts.beforeId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
    const items = sorted.slice(0, opts.limit).map((r) => ({ ...r }));
    return { items, hasMore: sorted.length > opts.limit };
  }
}
