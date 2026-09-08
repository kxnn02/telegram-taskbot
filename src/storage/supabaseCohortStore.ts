import type { SupabaseClient } from "@supabase/supabase-js";
import type { CohortStorePort } from "./cohortStorePort.js";

interface CohortRow {
  group_chat_id: string | null;
}

interface StandupEnabledRow {
  standup_enabled: boolean;
}

/** Real `CohortStorePort` implementation over the Supabase `cohorts` table
 * (ADR-0006), via the supabase-js query builder. */
export class SupabaseCohortStore implements CohortStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async getGroupChatId(cohortId: string): Promise<string | undefined> {
    const { data, error } = await this.client
      .from("cohorts")
      .select("group_chat_id")
      .eq("cohort_id", cohortId)
      .maybeSingle();
    if (error) {
      throw new Error(`getGroupChatId(${cohortId}) failed: ${error.message}`);
    }
    return (data as CohortRow | null)?.group_chat_id ?? undefined;
  }

  /** `groupChatId === ""` clears the column back to `null` — matches
   * `getGroupChatId`'s "undefined means unset" contract. */
  async setGroupChatId(cohortId: string, groupChatId: string): Promise<void> {
    const { error } = await this.client
      .from("cohorts")
      .update({ group_chat_id: groupChatId === "" ? null : groupChatId })
      .eq("cohort_id", cohortId);
    if (error) {
      throw new Error(`setGroupChatId(${cohortId}) failed: ${error.message}`);
    }
  }

  /** A cohort with no row at all reads as `false` (`maybeSingle()` returns
   * `null`), never a throw — matches `getGroupChatId`'s "unset means off"
   * contract. */
  async isStandupEnabled(cohortId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("cohorts")
      .select("standup_enabled")
      .eq("cohort_id", cohortId)
      .maybeSingle();
    if (error) {
      throw new Error(`isStandupEnabled(${cohortId}) failed: ${error.message}`);
    }
    return (data as StandupEnabledRow | null)?.standup_enabled ?? false;
  }

  async setStandupEnabled(cohortId: string, enabled: boolean): Promise<void> {
    const { error } = await this.client
      .from("cohorts")
      .update({ standup_enabled: enabled })
      .eq("cohort_id", cohortId);
    if (error) {
      throw new Error(`setStandupEnabled(${cohortId}) failed: ${error.message}`);
    }
  }
}
