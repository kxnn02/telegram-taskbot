import type { Note, Task } from "../domain/types.js";

/**
 * The storage port `TaskService` talks to instead of touching a database
 * directly (ADR-0005). It covers exactly what `TaskService` touches today
 * via `TaskRepository`: tasks (create/update/read/list), notes (append),
 * and per-cohort sequential task ids (`cohort_counters`). Registrations and
 * overdue-notification bookkeeping are used by the bot/scheduler layers
 * directly, never by `TaskService`, so they aren't part of this port.
 *
 * Every write is versioned per ADR-0006: a `TaskRecord`'s `rowVersion`
 * round-trips from the read it came from to the write that's based on it,
 * and `updateTask` rejects with `{ outcome: "conflict" }` — never a silent
 * overwrite — when the stored row's version no longer matches what was
 * read. The real Supabase adapter (Phase 2 / issue #13) implements this
 * against an actual `row_version` column exactly as ADR-0006 describes;
 * the in-memory fake in this phase implements the same contract entirely
 * in memory, so the adapter has a contract to satisfy rather than a design
 * decision to make.
 */

/** A task plus the optimistic-concurrency version it was read at. */
export type TaskRecord = Task & { rowVersion: number };

export type UpdateOutcome =
  | { outcome: "updated"; task: TaskRecord }
  | { outcome: "conflict" };

export interface TaskStorePort {
  /** Allocates and reserves the next sequential id for a cohort. */
  nextId(cohortId: string): Promise<number>;

  /** Inserts a brand-new task, starting at `rowVersion` 1. Callers are
   * expected to have obtained `task.id` from `nextId` first. */
  insertTask(task: Task): Promise<TaskRecord>;

  /** Updates a task, checking `task.rowVersion` against the currently
   * stored version. On a match, persists the patch (every field except
   * `notes`, which is a separate, unversioned append log written via
   * `insertNote`) and returns the updated record with `rowVersion`
   * incremented. On a mismatch — someone else wrote to this task since it
   * was read — returns a conflict outcome and leaves the stored row
   * untouched. */
  updateTask(task: TaskRecord): Promise<UpdateOutcome>;

  /** Appends a note. Independent of `rowVersion` — notes are a separate
   * append-only log, not a field guarded by the tasks row's concurrency
   * check (mirrors the current SQLite schema, where `notes` is its own
   * table). */
  insertNote(cohortId: string, taskId: number, note: Note): Promise<void>;

  findTaskById(cohortId: string, id: number): Promise<TaskRecord | undefined>;

  listTasksByCohort(cohortId: string): Promise<TaskRecord[]>;
}
