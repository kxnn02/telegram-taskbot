import type { SupabaseClient } from "@supabase/supabase-js";
import type { CertTipHistoryStorePort } from "./certTipHistoryStorePort.js";

/** Real `CertTipHistoryStorePort` implementation over the Supabase
 * `cohort_cert_tip_history` table. Used only by the on-demand `/standup`
 * command — the scheduled daily push job and dashboard Preview/Test never
 * touch this table. */
export class SupabaseCertTipHistoryStore implements CertTipHistoryStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async getLastTipId(cohortId: string): Promise<number | null> {
    const { data, error } = await this.client
      .from("cohort_cert_tip_history")
      .select("last_tip_id")
      .eq("cohort_id", cohortId)
      .maybeSingle();
    if (error) {
      throw new Error(`getLastTipId(${cohortId}) failed: ${error.message}`);
    }
    return data?.last_tip_id ?? null;
  }

  async setLastTipId(cohortId: string, tipId: number): Promise<void> {
    const { error } = await this.client.from("cohort_cert_tip_history").upsert({
      cohort_id: cohortId,
      last_tip_id: tipId,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      throw new Error(`setLastTipId(${cohortId}, ${tipId}) failed: ${error.message}`);
    }
  }
}
