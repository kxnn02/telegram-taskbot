import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobRunStatus } from "../domain/types.js";
import type { JobRunStorePort } from "./jobRunStorePort.js";

/** Real `JobRunStorePort` implementation over the Supabase `job_runs` table
 * (issue #43). A single insert — nothing to read back yet, so there's no
 * atomicity concern the way `SupabaseAlertThrottleStore`'s claim methods
 * have. */
export class SupabaseJobRunStore implements JobRunStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async record(jobName: string, status: JobRunStatus, detail: string | null): Promise<void> {
    const { error } = await this.client
      .from("job_runs")
      .insert({ job_name: jobName, status, detail });
    if (error) {
      throw new Error(`record(${jobName}, ${status}) failed: ${error.message}`);
    }
  }
}
