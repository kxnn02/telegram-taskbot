import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tag } from "../domain/types.js";
import type { TagStorePort } from "./tagStorePort.js";

interface TagRow {
  id: number;
  cohort_id: string;
  name: string;
  color: string;
}

interface TaskTagRow {
  task_id: number;
  tag_id: number;
}

/** Real `TagStorePort` implementation over the Supabase `tags`/`task_tags`
 * tables (issue #105 sub-stage 5b), cohort-scoped the same way
 * `SupabaseRosterStore` scopes every query (`.eq("cohort_id", cohortId)`).
 *
 * No live Supabase test is included in this worktree (no live credentials
 * available in this sandboxed environment — see the sub-stage 5b PR body);
 * this class is exercised only by typecheck/build, not by a `.live.test.ts`
 * run, unlike `supabaseRosterStore.live.test.ts`. */
export class SupabaseTagStore implements TagStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async listTagsByCohort(cohortId: string): Promise<Tag[]> {
    const { data, error } = await this.client
      .from("tags")
      .select("id, cohort_id, name, color")
      .eq("cohort_id", cohortId)
      .order("name", { ascending: true });
    if (error) {
      throw new Error(`listTagsByCohort(${cohortId}) failed: ${error.message}`);
    }
    return ((data ?? []) as TagRow[]).map(toTag);
  }

  async createTag(cohortId: string, name: string, color: string): Promise<Tag> {
    const { data, error } = await this.client
      .from("tags")
      .insert({ cohort_id: cohortId, name, color })
      .select("id, cohort_id, name, color")
      .single();
    if (error) {
      throw new Error(`createTag(${cohortId}, ${name}) failed: ${error.message}`);
    }
    return toTag(data as TagRow);
  }

  async listTaskTagIdsByCohort(cohortId: string): Promise<Map<number, number[]>> {
    const { data, error } = await this.client
      .from("task_tags")
      .select("task_id, tag_id")
      .eq("cohort_id", cohortId);
    if (error) {
      throw new Error(`listTaskTagIdsByCohort(${cohortId}) failed: ${error.message}`);
    }
    const result = new Map<number, number[]>();
    for (const row of (data ?? []) as TaskTagRow[]) {
      const existing = result.get(row.task_id);
      if (existing) {
        existing.push(row.tag_id);
      } else {
        result.set(row.task_id, [row.tag_id]);
      }
    }
    return result;
  }

  async setTaskTags(cohortId: string, taskId: number, tagIds: number[]): Promise<void> {
    const { error: deleteError } = await this.client
      .from("task_tags")
      .delete()
      .eq("cohort_id", cohortId)
      .eq("task_id", taskId);
    if (deleteError) {
      throw new Error(
        `setTaskTags(${cohortId}, ${taskId}) failed to clear existing rows: ${deleteError.message}`,
      );
    }
    if (tagIds.length === 0) return;
    const { error: insertError } = await this.client
      .from("task_tags")
      .insert(tagIds.map((tagId) => ({ cohort_id: cohortId, task_id: taskId, tag_id: tagId })));
    if (insertError) {
      throw new Error(
        `setTaskTags(${cohortId}, ${taskId}) failed to insert new rows: ${insertError.message}`,
      );
    }
  }
}

function toTag(row: TagRow): Tag {
  return { id: row.id, cohortId: row.cohort_id, name: row.name, color: row.color };
}
