import type { SupabaseClient } from "@supabase/supabase-js";
import type { CohortStorePort } from "./cohortStorePort.js";

interface CohortRow {
  group_chat_id: string | null;
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
}
