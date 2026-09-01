import type { SupabaseClient } from "@supabase/supabase-js";
import type { Note, Task, TaskStatus } from "../domain/types.js";
import type { TaskRecord, TaskStorePort, UpdateOutcome } from "./taskStorePort.js";

interface TaskRow {
  id: number;
  cohort_id: string;
  title: string;
  description: string | null;
  assignee_username: string;
  assigned_by_username: string;
  due_date: string;
  status: TaskStatus;
  previous_status: TaskStatus | null;
  blocked_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  note_id: number;
  cohort_id: string;
  task_id: number;
  text: string;
  author_username: string;
  created_at: string;
}

/**
 * Real `TaskStorePort` implementation over Supabase Postgres (ADR-0005/
 * ADR-0006), talking to the `tasks`/`notes`/`cohort_counters` tables via
 * the `supabase-js` query builder (PostgREST), never raw SQL strings.
 *
 * `nextId` goes through the `increment_cohort_counter` RPC (see the
 * migration in `supabase/migrations/`) since a plain read-then-write over
 * PostgREST can't atomically increment a counter across concurrent
 * invocations — exactly the class of bug ADR-0006 calls out.
 *
 * `updateTask` filters its `.update()` on `row_version = task.rowVersion`
 * and asks PostgREST to return the matched row(s); zero rows back means
 * someone else's write already moved the version on, surfaced as
 * `{ outcome: "conflict" }` per the port's contract — never a silent
 * overwrite.
 */
export class SupabaseTaskStore implements TaskStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async nextId(cohortId: string): Promise<number> {
    const { data, error } = await this.client.rpc("increment_cohort_counter", {
      p_cohort_id: cohortId,
    });
    if (error) {
      throw new Error(`nextId(${cohortId}) failed: ${error.message}`);
    }
    return data as number;
  }

  async insertTask(task: Task): Promise<TaskRecord> {
    const { data, error } = await this.client
      .from("tasks")
      .insert(toInsertRow(task))
      .select()
      .single();
    if (error) {
      throw new Error(
        `insertTask failed for task ${task.id} in cohort ${task.cohortId} ` +
          `(already exists? insertTask expects a fresh id from nextId()): ${error.message}`,
      );
    }

    const notes: Note[] = [];
    for (const note of task.notes) {
      await this.insertNote(task.cohortId, task.id, note);
      notes.push(note);
    }
    return toRecord(data as TaskRow, notes);
  }

  async updateTask(task: TaskRecord): Promise<UpdateOutcome> {
    const { data, error } = await this.client
      .from("tasks")
      .update({
        title: task.title,
        description: task.description ?? null,
        assignee_username: task.assigneeUsername,
        assigned_by_username: task.assignedByUsername,
        due_date: task.dueDate,
        status: task.status,
        previous_status: task.previousStatus,
        blocked_reason: task.blockedReason,
        updated_at: task.updatedAt,
        row_version: task.rowVersion + 1,
      })
      .eq("cohort_id", task.cohortId)
      .eq("id", task.id)
      .eq("row_version", task.rowVersion)
      .select();
    if (error) {
      throw new Error(`updateTask failed for task ${task.id}: ${error.message}`);
    }
    if (!data || data.length === 0) {
      // Zero rows matched: either the row_version had already moved on
      // (someone else's write), or the task doesn't exist at all — both
      // are reported the same way per the port's contract.
      return { outcome: "conflict" };
    }

    // `notes` is a separate, unversioned append log (see taskStorePort.ts)
    // — updateTask never touches it, only insertNote does, so it's read
    // back fresh here rather than trusted from the caller's stale copy.
    const notes = await this.notesFor(task.cohortId, task.id);
    return { outcome: "updated", task: toRecord(data[0] as TaskRow, notes) };
  }

  async insertNote(cohortId: string, taskId: number, note: Note): Promise<void> {
    const { error } = await this.client.from("notes").insert({
      cohort_id: cohortId,
      task_id: taskId,
      text: note.text,
      author_username: note.authorUsername,
      created_at: note.createdAt,
    });
    if (error) {
      throw new Error(`insertNote failed for task ${taskId} in cohort ${cohortId}: ${error.message}`);
    }
  }

  async findTaskById(cohortId: string, id: number): Promise<TaskRecord | undefined> {
    const { data, error } = await this.client
      .from("tasks")
      .select()
      .eq("cohort_id", cohortId)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new Error(`findTaskById(${cohortId}, ${id}) failed: ${error.message}`);
    }
    if (!data) return undefined;
    const notes = await this.notesFor(cohortId, id);
    return toRecord(data as TaskRow, notes);
  }

  async listTasksByCohort(cohortId: string): Promise<TaskRecord[]> {
    const { data, error } = await this.client
      .from("tasks")
      .select()
      .eq("cohort_id", cohortId)
      .order("id", { ascending: true });
    if (error) {
      throw new Error(`listTasksByCohort(${cohortId}) failed: ${error.message}`);
    }
    const rows = (data ?? []) as TaskRow[];
    const records: TaskRecord[] = [];
    for (const row of rows) {
      records.push(toRecord(row, await this.notesFor(cohortId, row.id)));
    }
    return records;
  }

  private async notesFor(cohortId: string, taskId: number): Promise<Note[]> {
    const { data, error } = await this.client
      .from("notes")
      .select()
      .eq("cohort_id", cohortId)
      .eq("task_id", taskId)
      .order("note_id", { ascending: true });
    if (error) {
      throw new Error(`notesFor(${cohortId}, ${taskId}) failed: ${error.message}`);
    }
    return (data as NoteRow[]).map((row) => ({
      text: row.text,
      authorUsername: row.author_username,
      createdAt: row.created_at,
    }));
  }
}

function toInsertRow(task: Task) {
  return {
    id: task.id,
    cohort_id: task.cohortId,
    title: task.title,
    description: task.description ?? null,
    assignee_username: task.assigneeUsername,
    assigned_by_username: task.assignedByUsername,
    due_date: task.dueDate,
    status: task.status,
    previous_status: task.previousStatus,
    blocked_reason: task.blockedReason,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function toRecord(row: TaskRow, notes: Note[]): TaskRecord {
  return {
    id: row.id,
    cohortId: row.cohort_id,
    title: row.title,
    description: row.description ?? undefined,
    assigneeUsername: row.assignee_username,
    assignedByUsername: row.assigned_by_username,
    dueDate: row.due_date,
    status: row.status,
    notes,
    previousStatus: row.previous_status,
    blockedReason: row.blocked_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: row.row_version,
  };
}
