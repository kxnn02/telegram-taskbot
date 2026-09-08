import type { AuditLogStorePort } from "../storage/auditLogStorePort.js";
import type { CohortStorePort } from "../storage/cohortStorePort.js";
import { fail, ok, type AuditLog, type Caller, type ServiceResult } from "../domain/types.js";

/**
 * Settings-page service (issue #105 sub-stage 5c), parallel to `TagService`:
 * business rules live here, independent of Telegram/HTTP, talking to
 * Supabase only through `CohortStorePort`/`AuditLogStorePort` (ADR-0002/
 * ADR-0006), same as every other service in this codebase.
 *
 * Ports Devie's `app/dashboard/settings/page.tsx` minus the bot-token field
 * and the whole `telegram_config` concept (ticket decision 2): the only
 * field this repo's settings page edits is the cohort's Telegram group chat
 * id, already a plain column on `cohorts` (ADR-0006) — everything else on
 * Devie's page (`standup_enabled`, the webhook-connection card, the
 * standup preview/send actions, theme switching) has no analog here and is
 * dropped, per decision 4 and the sub-stage 5c PR's write-up.
 *
 * `saveGroupChatId` is `audit_logs`' one writer (matches Devie's own
 * codebase, where `app/dashboard/settings/page.tsx:137` is the only
 * insert) — mirrors Devie's `handleSave`/`addAuditLog` pairing
 * (`:217-236`) exactly: save, then write an `ok`/`error` row with the same
 * `settings.config.save` action and `"Settings saved"`/`"Save failed"`
 * messages.
 */
export class SettingsService {
  constructor(
    private readonly cohortStore: CohortStorePort,
    private readonly auditLogStore: AuditLogStorePort,
  ) {}

  async getSettings(
    caller: Caller,
  ): Promise<ServiceResult<{ groupChatId: string | undefined; standupEnabled: boolean }>> {
    const [groupChatId, standupEnabled] = await Promise.all([
      this.cohortStore.getGroupChatId(caller.cohortId),
      this.cohortStore.isStandupEnabled(caller.cohortId),
    ]);
    return ok({ groupChatId, standupEnabled });
  }

  async saveGroupChatId(caller: Caller, groupChatId: string): Promise<ServiceResult<void>> {
    try {
      await this.cohortStore.setGroupChatId(caller.cohortId, groupChatId);
    } catch {
      await this.auditLogStore.insert(caller.cohortId, {
        action: "settings.config.save",
        status: "error",
        message: "Save failed",
      });
      return fail("Save failed");
    }
    await this.auditLogStore.insert(caller.cohortId, {
      action: "settings.config.save",
      status: "ok",
      message: "Settings saved",
    });
    return ok(undefined);
  }

  /** Issue #131 Build 4's Auto-standup switch — same save/audit pairing as
   * `saveGroupChatId`, its own `settings.standup.toggle` action so the
   * activity log distinguishes the two. */
  async saveStandupEnabled(caller: Caller, enabled: boolean): Promise<ServiceResult<void>> {
    try {
      await this.cohortStore.setStandupEnabled(caller.cohortId, enabled);
    } catch {
      await this.auditLogStore.insert(caller.cohortId, {
        action: "settings.standup.toggle",
        status: "error",
        message: "Save failed",
      });
      return fail("Save failed");
    }
    await this.auditLogStore.insert(caller.cohortId, {
      action: "settings.standup.toggle",
      status: "ok",
      message: "Settings saved",
    });
    return ok(undefined);
  }

  /** Mirrors Devie's `fetchAuditLogs` (`:126-134`) — the settings page's own
   * inline activity log, not the dedicated activity-log view (that's
   * sub-stage 5e's job, per the ticket). */
  async listRecentActivity(caller: Caller, limit: number): Promise<ServiceResult<AuditLog[]>> {
    return ok(await this.auditLogStore.listRecent(caller.cohortId, limit));
  }
}
