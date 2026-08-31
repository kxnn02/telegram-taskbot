import type { Note, Task } from "../domain/types.js";
import type { TaskRecord, TaskStorePort, UpdateOutcome } from "./taskStorePort.js";

function key(cohortId: string, id: number): string {
  return `${cohortId}:${id}`;
}

/**
 * In-memory implementation of `TaskStorePort` (ADR-0005): used by tests
 * (and, for now, by production wiring — see `createBot.ts`/`web/index.ts`
 * doc comments — as a placeholder until the real Supabase adapter lands in
 * Phase 2 / issue #13). Data lives only for the lifetime of the process;
 * nothing here is persisted to disk.
 */
export class InMemoryTaskStore implements TaskStorePort {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly nextIds = new Map<string, number>();

  async nextId(cohortId: string): Promise<number> {
    const id = this.nextIds.get(cohortId) ?? 1;
    this.nextIds.set(cohortId, id + 1);
    return id;
  }

  async insertTask(task: Task): Promise<TaskRecord> {
    const k = key(task.cohortId, task.id);
    if (this.tasks.has(k)) {
      throw new Error(
        `Task ${task.id} already exists in cohort ${task.cohortId} — insertTask expects a fresh id from nextId().`,
      );
    }
    const record: TaskRecord = { ...task, notes: [...task.notes], rowVersion: 1 };
    this.tasks.set(k, record);
    return clone(record);
  }

  async updateTask(task: TaskRecord): Promise<UpdateOutcome> {
    const k = key(task.cohortId, task.id);
    const current = this.tasks.get(k);
    if (!current || current.rowVersion !== task.rowVersion) {
      return { outcome: "conflict" };
    }
    // `notes` is a separate, unversioned append log (see taskStorePort.ts)
    // — updateTask never touches it, only insertNote does.
    const updated: TaskRecord = {
      ...task,
      notes: current.notes,
      rowVersion: current.rowVersion + 1,
    };
    this.tasks.set(k, updated);
    return { outcome: "updated", task: clone(updated) };
  }

  async insertNote(cohortId: string, taskId: number, note: Note): Promise<void> {
    const current = this.tasks.get(key(cohortId, taskId));
    if (!current) return;
    current.notes.push(note);
  }

  async findTaskById(cohortId: string, id: number): Promise<TaskRecord | undefined> {
    const current = this.tasks.get(key(cohortId, id));
    return current ? clone(current) : undefined;
  }

  async listTasksByCohort(cohortId: string): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter((t) => t.cohortId === cohortId)
      .sort((a, b) => a.id - b.id)
      .map(clone);
  }
}

function clone(record: TaskRecord): TaskRecord {
  return { ...record, notes: [...record.notes] };
}
