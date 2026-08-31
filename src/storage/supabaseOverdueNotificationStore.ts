import type { SupabaseClient } from "@supabase/supabase-js";
import type { OverdueNotificationStorePort } from "./overdueNotificationStorePort.js";

/** Real `OverdueNotificationStorePort` implementation over the Supabase
 * `overdue_notifications` table (ADR-0006), via the supabase-js query
 * builder. */
export class SupabaseOverdueNotificationStore implements OverdueNotificationStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async hasNotified(cohortId: string, taskId: number): Promise<boolean> {
    const { data, error } = await this.client
      .from("overdue_notifications")
      .select("cohort_id")
      .eq("cohort_id", cohortId)
      .eq("task_id", taskId)
      .maybeSingle();
    if (error) {
      throw new Error(`hasNotified(${cohortId}, ${taskId}) failed: ${error.message}`);
    }
    return data !== null;
  }

  async markNotified(cohortId: string, taskId: number): Promise<void> {
    const { error } = await this.client.from("overdue_notifications").upsert(
      {
        cohort_id: cohortId,
        task_id: taskId,
        notified_at: new Date().toISOString(),
      },
      { onConflict: "cohort_id,task_id", ignoreDuplicates: true },
    );
    if (error) {
      throw new Error(`markNotified(${cohortId}, ${taskId}) failed: ${error.message}`);
    }
  }
}
