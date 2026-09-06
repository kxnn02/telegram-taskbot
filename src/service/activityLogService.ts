import type { AuditLogStorePort } from "../storage/auditLogStorePort.js";
import { ok, type AuditLog, type Caller, type ServiceResult } from "../domain/types.js";

/**
 * Service backing the dedicated activity-log page (issue #105 sub-stage
 * 5e) — parallel to `SettingsService`/`TagService`: business rules
 * (here, just cohort scoping) live here, independent of Telegram/HTTP,
 * talking to Supabase only through `AuditLogStorePort` (ADR-0002/ADR-0006).
 *
 * `SettingsService.listRecentActivity` (5c) stays the settings page's own
 * inline, capped-at-50 preview and is untouched by this — this is a
 * separate seam for the standalone, paginated view the ticket calls for,
 * reusing the same `AuditLogStorePort` both were already built against
 * rather than duplicating it. `audit_logs` has exactly one writer
 * (`SettingsService.saveGroupChatId`, see its doc comment) — this service
 * only ever reads.
 */
export class ActivityLogService {
  constructor(private readonly auditLogStore: AuditLogStorePort) {}

  async listPage(
    caller: Caller,
    opts: { limit: number; beforeId?: number },
  ): Promise<ServiceResult<{ items: AuditLog[]; hasMore: boolean }>> {
    return ok(await this.auditLogStore.listPage(caller.cohortId, opts));
  }
}
