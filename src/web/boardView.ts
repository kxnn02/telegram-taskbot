import type { Tag, Task, TaskStatus } from "../domain/types.js";

/**
 * Pure grouping/tagging/reordering logic for the dashboard's kanban board
 * (issue #105 sub-stage 5b) — same convention as `taskView.ts`: plain
 * functions operating only on already-fetched data, no I/O, no React.
 */

/** Fixed column order the board always renders in, independent of however
 * the tasks came back from the API. */
export const BOARD_STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
];

/** One bucket per status, in `BOARD_STATUS_ORDER`, each bucket sorted by
 * `orderIndex` ascending then `id` ascending as a tiebreak. A status with no
 * tasks still gets an empty array (so the board always renders all six
 * columns, even empty ones). */
export function groupTasksByStatus<T extends Pick<Task, "id" | "status" | "orderIndex">>(
  tasks: T[],
): Map<TaskStatus, T[]> {
  const grouped = new Map<TaskStatus, T[]>(BOARD_STATUS_ORDER.map((s) => [s, []]));
  for (const task of tasks) {
    grouped.get(task.status)!.push(task);
  }
  for (const status of BOARD_STATUS_ORDER) {
    grouped.get(status)!.sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
  }
  return grouped;
}

/** Server-side equivalent of Devie's client-side join flattening
 * (`t.tags?.map(tt => tt.tag).filter(Boolean) || []` in `hooks/use-tasks.ts`)
 * — done here as a pure function over already-fetched `tagIdsByTask` /
 * `tagsById` maps rather than a Supabase join (no browser-side Supabase
 * client in this repo, ADR-0002/ADR-0006). Tag ids that don't resolve to a
 * known tag are filtered out, mirroring Devie's `.filter(Boolean)`; the
 * resulting `tags` are ordered by tag id ascending (an ordering choice made
 * here since Devie's own join has no defined order either). */
export function flattenTaskTags<T extends { id: number }>(
  tasks: T[],
  tagIdsByTask: Map<number, number[]>,
  tagsById: Map<number, Tag>,
): Array<T & { tags: Tag[] }> {
  return tasks.map((task) => {
    const tagIds = tagIdsByTask.get(task.id) ?? [];
    const tags = tagIds
      .map((id) => tagsById.get(id))
      .filter((t): t is Tag => t !== undefined)
      .sort((a, b) => a.id - b.id);
    return { ...task, tags };
  });
}

/** Reorders a kanban column: moves the task with `movedTaskId` to
 * `targetIndex` (0-based, clamped into the valid range), then returns the
 * WHOLE column reindexed sequentially (`orderIndex = 0, 1, 2, ...` in the
 * new display order) — Devie's own approach (`hooks/use-tasks.ts`'s
 * `reorderTasks`: `order_index = i` for each task in array order), not a
 * fractional-index scheme. Pure: does not mutate `columnTasks`. */
export function reorderColumn<T extends { id: number; orderIndex: number }>(
  columnTasks: T[],
  movedTaskId: number,
  targetIndex: number,
): T[] {
  const currentIndex = columnTasks.findIndex((t) => t.id === movedTaskId);
  if (currentIndex === -1) {
    // Nothing to move — return a sequentially-reindexed copy unchanged in
    // order, same as any other call, rather than throwing.
    return columnTasks.map((t, i) => ({ ...t, orderIndex: i }));
  }

  const clampedTarget = Math.max(0, Math.min(targetIndex, columnTasks.length - 1));

  const withoutMoved = columnTasks.filter((_, i) => i !== currentIndex);
  const moved = columnTasks[currentIndex]!;
  const reordered = [
    ...withoutMoved.slice(0, clampedTarget),
    moved,
    ...withoutMoved.slice(clampedTarget),
  ];

  return reordered.map((t, i) => ({ ...t, orderIndex: i }));
}
