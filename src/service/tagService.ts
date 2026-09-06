import type { TagStorePort } from "../storage/tagStorePort.js";
import { fail, ok, type Caller, type ServiceResult, type Tag, type Task } from "../domain/types.js";
import type { TaskService } from "./taskService.js";

const DEFAULT_TAG_COLOR = "#6366f1";

function requireNonEmpty(value: string, label: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return `${label} can't be empty.`;
  }
  return undefined;
}

/**
 * The tag-service layer (issue #105 sub-stage 5b), parallel to `TaskService`:
 * every tag-related business rule lives here, independent of Telegram/HTTP,
 * talking to Supabase only through the `TagStorePort` seam (ADR-0002/
 * ADR-0006), same as `TaskService` does through `TaskStorePort`.
 *
 * `listTasksWithTags` lives here rather than on `TaskService` so
 * `TaskService`'s constructor/signature stays untouched by this stage —
 * it takes the already-constructed `TaskService` as a dependency and reuses
 * its `listAllTasks` (cohort-scoped task listing) rather than duplicating
 * that logic against `TaskStorePort` directly.
 */
export class TagService {
  constructor(
    private readonly store: TagStorePort,
    private readonly taskService: TaskService,
  ) {}

  /** Cohort-scoped list, ordered by name. */
  async listTags(caller: Caller): Promise<ServiceResult<Tag[]>> {
    return ok(await this.store.listTagsByCohort(caller.cohortId));
  }

  /** `color` defaults to `#6366f1` when omitted (decision 3) — enforced
   * here, not just relying on the `tags.color` column default, since that
   * default only applies when the column is omitted from the insert
   * entirely, and `SupabaseTagStore.createTag` always includes it. */
  async createTag(caller: Caller, name: string, color?: string): Promise<ServiceResult<Tag>> {
    const err = requireNonEmpty(name, "Tag name");
    if (err) return fail(err);
    const tag = await this.store.createTag(caller.cohortId, name.trim(), color ?? DEFAULT_TAG_COLOR);
    return ok(tag);
  }

  /** Every task in the caller's cohort, each with its `tags` resolved via
   * the server-side join this repo does instead of a browser-side Supabase
   * join (see `flattenTaskTags` in `boardView.ts`) — the data the
   * dashboard's kanban board fetches on mount (`GET /api/board`). */
  async listTasksWithTags(
    caller: Caller,
  ): Promise<ServiceResult<Array<Task & { tags: Tag[] }>>> {
    const tasksResult = await this.taskService.listAllTasks(caller);
    if (!tasksResult.ok) return fail(tasksResult.error);

    const [tagIdsByTask, allTags] = await Promise.all([
      this.store.listTaskTagIdsByCohort(caller.cohortId),
      this.store.listTagsByCohort(caller.cohortId),
    ]);
    const tagsById = new Map(allTags.map((t) => [t.id, t]));

    const withTags = tasksResult.value.map((task) => {
      const tagIds = tagIdsByTask.get(task.id) ?? [];
      const tags = tagIds
        .map((id) => tagsById.get(id))
        .filter((t): t is Tag => t !== undefined)
        .sort((a, b) => a.id - b.id);
      return { ...task, tags };
    });
    return ok(withTags);
  }

  /** Replace-all semantics (decision — matches Devie's task-dialog save
   * flow). Verifies the task exists in the caller's cohort first, via
   * `TaskService.getTask` (which already does the cohort-scoped lookup and
   * not-found handling `TaskService` uses everywhere else), rather than
   * duplicating that check against `TaskStorePort` directly. */
  async setTaskTags(caller: Caller, taskId: number, tagIds: number[]): Promise<ServiceResult<void>> {
    const found = await this.taskService.getTask(caller, taskId);
    if (!found.ok) return fail(found.error);

    await this.store.setTaskTags(caller.cohortId, taskId, tagIds);
    return ok(undefined);
  }
}
