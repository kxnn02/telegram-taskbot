import type { Tag } from "../domain/types.js";

/**
 * The storage port `TagService` (and `TaskService.listTasksWithTags`) talk
 * to instead of touching Supabase directly (ADR-0002/ADR-0006 — the same
 * seam pattern as `TaskStorePort`). Covers the `tags`/`task_tags` tables
 * added by `supabase/migrations/20260905134102_task_priority_tags_and_audit.sql`.
 *
 * Every tag is cohort-scoped (issue #105 sub-stage 5b, decision 2 — unlike
 * DevieBot, whose tags are un-scoped): every method here takes or implies a
 * `cohortId` and every implementation must filter by it.
 */
export interface TagStorePort {
  /** All tags for a cohort, ordered by name (matches DevieBot's
   * `.order('name')` load in `task-dialog.tsx`). */
  listTagsByCohort(cohortId: string): Promise<Tag[]>;

  /** Creates a new tag. `color` is always a concrete hex string by the time
   * it reaches this port — `TagService.createTag` is where the `#6366f1`
   * default gets applied (decision 3), not here. */
  createTag(cohortId: string, name: string, color: string): Promise<Tag>;

  /** Tag ids per task, for every task in the cohort — the server-side join
   * this repo does instead of a browser-side Supabase join (ADR-0002/
   * ADR-0006: no browser-side Supabase client here, unlike DevieBot's
   * `tasks:task_tags(tag:tags(*))` select). */
  listTaskTagIdsByCohort(cohortId: string): Promise<Map<number, number[]>>;

  /** Replace-all semantics, matching Devie's task-dialog save behaviour
   * (`components/kanban/task-dialog.tsx`'s toggle-then-save-full-set flow,
   * `hooks/use-tasks.ts:140-147`'s delete-then-insert): deletes every
   * existing `task_tags` row for this task, then inserts the given set. */
  setTaskTags(cohortId: string, taskId: number, tagIds: number[]): Promise<void>;
}
