import type { DatabaseSync } from "node:sqlite";
import type { Note, Task, TaskStatus } from "../domain/types.js";

interface TaskRow {
  id: number;
  cohort_id: string;
  title: string;
  description: string;
  assignee_username: string;
  assigned_by_username: string;
  due_date: string;
  status: TaskStatus;
  blocked: number;
  blocked_reason: string | null;
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
 * Thin persistence layer over SQLite. Knows how to read/write task rows and
 * map them to/from the domain `Task` shape. Contains no business rules —
 * those live entirely in the task-service layer, which is the only caller.
 */
export class TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Allocates and reserves the next sequential id for a cohort. */
  nextId(cohortId: string): number {
    const row = this.db
      .prepare("SELECT next_id FROM cohort_counters WHERE cohort_id = ?")
      .get(cohortId) as { next_id: number } | undefined;

    const id = row ? row.next_id : 1;

    if (row) {
      this.db
        .prepare("UPDATE cohort_counters SET next_id = ? WHERE cohort_id = ?")
        .run(id + 1, cohortId);
    } else {
      this.db
        .prepare(
          "INSERT INTO cohort_counters (cohort_id, next_id) VALUES (?, ?)",
        )
        .run(cohortId, id + 1);
    }

    return id;
  }

  insert(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks
          (id, cohort_id, title, description, assignee_username, assigned_by_username,
           due_date, status, blocked, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.cohortId,
        task.title,
        task.description,
        task.assigneeUsername,
        task.assignedByUsername,
        task.dueDate,
        task.status,
        task.blocked ? 1 : 0,
        task.blockedReason,
        task.createdAt,
        task.updatedAt,
      );
    for (const note of task.notes) {
      this.insertNote(task.cohortId, task.id, note);
    }
  }

  update(task: Task): void {
    this.db
      .prepare(
        `UPDATE tasks SET
           title = ?, description = ?, assignee_username = ?, assigned_by_username = ?,
           due_date = ?, status = ?, blocked = ?, blocked_reason = ?, updated_at = ?
         WHERE cohort_id = ? AND id = ?`,
      )
      .run(
        task.title,
        task.description,
        task.assigneeUsername,
        task.assignedByUsername,
        task.dueDate,
        task.status,
        task.blocked ? 1 : 0,
        task.blockedReason,
        task.updatedAt,
        task.cohortId,
        task.id,
      );
  }

  insertNote(cohortId: string, taskId: number, note: Note): void {
    this.db
      .prepare(
        `INSERT INTO notes (cohort_id, task_id, text, author_username, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(cohortId, taskId, note.text, note.authorUsername, note.createdAt);
  }

  findById(cohortId: string, id: number): Task | undefined {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE cohort_id = ? AND id = ?")
      .get(cohortId, id) as TaskRow | undefined;
    if (!row) return undefined;
    return this.toTask(row);
  }

  /** Finds a task by id across ALL cohorts — used only to distinguish
   * "doesn't exist" from "exists in another cohort" for clearer error
   * messages, never to leak cross-cohort data into a result. */
  findByIdAnyCohort(id: number): Task | undefined {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ? LIMIT 1")
      .get(id) as TaskRow | undefined;
    if (!row) return undefined;
    return this.toTask(row);
  }

  listByCohort(cohortId: string): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE cohort_id = ? ORDER BY id ASC")
      .all(cohortId) as unknown as TaskRow[];
    return rows.map((r) => this.toTask(r));
  }

  private notesFor(cohortId: string, taskId: number): Note[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM notes WHERE cohort_id = ? AND task_id = ? ORDER BY note_id ASC",
      )
      .all(cohortId, taskId) as unknown as NoteRow[];
    return rows.map((r) => ({
      text: r.text,
      authorUsername: r.author_username,
      createdAt: r.created_at,
    }));
  }

  private toTask(row: TaskRow): Task {
    return {
      id: row.id,
      cohortId: row.cohort_id,
      title: row.title,
      description: row.description,
      assigneeUsername: row.assignee_username,
      assignedByUsername: row.assigned_by_username,
      dueDate: row.due_date,
      status: row.status,
      notes: this.notesFor(row.cohort_id, row.id),
      blocked: row.blocked === 1,
      blockedReason: row.blocked_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
