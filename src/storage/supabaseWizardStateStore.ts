import type { SupabaseClient } from "@supabase/supabase-js";
import type { WizardState, WizardData, WizardKind, WizardStep } from "../bot/wizard.js";
import type { WizardStateStorePort } from "./wizardStateStorePort.js";

interface WizardStateRow {
  telegram_user_id: number;
  kind: string;
  step: string;
  data: WizardData;
  updated_at: string;
}

/** Real `WizardStateStorePort` implementation over the Supabase
 * `wizard_state` table (ADR-0006). `lastActivity` (an epoch-ms number in
 * memory) round-trips through the row's `updated_at` timestamptz column;
 * stale rows are swept daily by a `pg_cron` job (see the
 * `wizard_state_cleanup` migration), since the 20-minute expiry has no
 * built-in Postgres row-TTL equivalent. */
export class SupabaseWizardStateStore implements WizardStateStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async get(telegramUserId: number): Promise<WizardState | undefined> {
    const { data, error } = await this.client
      .from("wizard_state")
      .select("telegram_user_id, kind, step, data, updated_at")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) {
      throw new Error(`get(${telegramUserId}) failed: ${error.message}`);
    }
    if (!data) return undefined;
    const row = data as WizardStateRow;
    return {
      kind: row.kind as WizardKind,
      step: row.step as WizardStep,
      data: row.data,
      lastActivity: new Date(row.updated_at).getTime(),
    };
  }

  async set(telegramUserId: number, state: WizardState): Promise<void> {
    const { error } = await this.client.from("wizard_state").upsert(
      {
        telegram_user_id: telegramUserId,
        kind: state.kind,
        step: state.step,
        data: state.data,
        updated_at: new Date(state.lastActivity).toISOString(),
      },
      { onConflict: "telegram_user_id" },
    );
    if (error) {
      throw new Error(`set(${telegramUserId}) failed: ${error.message}`);
    }
  }

  async delete(telegramUserId: number): Promise<boolean> {
    const { data, error } = await this.client
      .from("wizard_state")
      .delete()
      .eq("telegram_user_id", telegramUserId)
      .select();
    if (error) {
      throw new Error(`delete(${telegramUserId}) failed: ${error.message}`);
    }
    return (data ?? []).length > 0;
  }
}
