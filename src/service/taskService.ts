import type { DatabaseSync } from "node:sqlite";
import { TaskRepository } from "../db/taskRepository.js";
import type { Clock } from "../domain/clock.js";
import { isOverdue, daysOverdue } from "../domain/overdue.js";
import { normalizeUsername, Roster } from "../domain/roster.js";
import {
  fail,
  ok,
  type Caller,
  type ServiceResult,
  type Task,
  type TaskStatus,
} from "../domain/types.js";

export interface AssignTaskInput {
  assigneeUsername: string;
  title: string;
  description: string;
  dueDate: string; // ISO yyyy-MM-dd, already resolved by the bot's date parser
}

export type EditTaskInput = Partial<AssignTaskInput>;

export interface TaskWithFlags extends Task {
  overdue: boolean;
  daysOverdue: number;
}

export interface InternCompletionStats {
  username: string;
  completed: number;
}

/** Cohort-wide stats for the dashboard's stats view (issue #4), derived
 * entirely from existing task fields — no new tracking/columns. See the
 * per-field doc comments on `getStats` for the exact definitions used. */
export interface CohortStats {
  /** Approved-task count per known intern in the cohort, including interns
   * with zero, sorted by username. */
  completedPerIntern: InternCompletionStats[];
  /** Approved / (all non-Cancelled tasks) for the cohort. 0 when there are
   * no countable tasks. Cancelled tasks are excluded entirely (PRD §4). */
  completionRate: number;
  /** Average hours between createdAt and updatedAt for tasks *currently* in
   * Submitted status. This is a best-effort approximation: `updatedAt` is a
   * single last-write-wins timestamp, not a status-change history, so it
   * only reflects the actual submission instant for tasks that haven't been
   * edited or reviewed since — which is exactly the currently-Submitted
   * subset. `null` when there's no such data yet. */
  averageTimeToSubmitHours: number | null;
  /** Count of tasks Approved within the last 7 days. Reliable because
   * `editTask` refuses to touch a task once Approved, so `updatedAt` on an
   * Approved task is frozen at the moment it was approved. */
  completedThisWeek: number;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_WEEK = 7 * 24 * MS_PER_HOUR;

const OPEN_STATUSES: TaskStatus[] = [
  "Assigned",
  "InProgress",
  "Submitted",
  "NeedsRevision",
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sameCohort(caller: Caller, task: Task): boolean {
  return caller.cohortId === task.cohortId;
}

function displayName(username: string): string {
  return `@${username}`;
}

/**
 * The task-service layer: every business rule in the system lives here as a
 * plain function, independent of Telegram/HTTP. Both the bot layer and the
 * (future) dashboard call into this same layer. See PRD §12 and issue #1's
 * "Implementation Decisions".
 */
export class TaskService {
  private readonly repo: TaskRepository;

  constructor(
    db: DatabaseSync,
    private readonly roster: Roster,
    private readonly clock: Clock,
  ) {
    this.repo = new TaskRepository(db);
  }

  // ---- Mutations -----------------------------------------------------

  assignTask(caller: Caller, input: AssignTaskInput): ServiceResult<Task> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can assign tasks.");
    }

    const assignee = normalizeUsername(input.assigneeUsername);
    if (!this.roster.isIntern(assignee, caller.cohortId)) {
      return fail(
        `${displayName(assignee)} isn't a known intern in this cohort — tasks can only be assigned to interns.`,
      );
    }

    const titleError = requireNonEmpty(input.title, "Title");
    if (titleError) return fail(titleError);
    const descError = requireNonEmpty(input.description, "Description");
    if (descError) return fail(descError);
    const dueDateError = requireValidDate(input.dueDate);
    if (dueDateError) return fail(dueDateError);

    const now = this.clock.now().toISOString();
    const id = this.repo.nextId(caller.cohortId);
    const task: Task = {
      id,
      cohortId: caller.cohortId,
      title: input.title.trim(),
      description: input.description.trim(),
      assigneeUsername: assignee,
      assignedByUsername: normalizeUsername(caller.username),
      dueDate: input.dueDate,
      status: "Assigned",
      notes: [],
      blocked: false,
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.repo.insert(task);
    return ok(task);
  }

  editTask(
    caller: Caller,
    taskId: number,
    patch: EditTaskInput,
  ): ServiceResult<Task> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can edit tasks.");
    }

    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    if (task.status === "Approved") {
      return fail(
        `Task ${taskId} is already Approved and is locked from further edits.`,
      );
    }
    if (task.status === "Cancelled") {
      return fail(`Task ${taskId} was cancelled and can no longer be edited.`);
    }

    if (patch.assigneeUsername !== undefined) {
      const assignee = normalizeUsername(patch.assigneeUsername);
      if (!this.roster.isIntern(assignee, caller.cohortId)) {
        return fail(
          `${displayName(assignee)} isn't a known intern in this cohort — tasks can only be assigned to interns.`,
        );
      }
      task.assigneeUsername = assignee;
    }
    if (patch.title !== undefined) {
      const err = requireNonEmpty(patch.title, "Title");
      if (err) return fail(err);
      task.title = patch.title.trim();
    }
    if (patch.description !== undefined) {
      const err = requireNonEmpty(patch.description, "Description");
      if (err) return fail(err);
      task.description = patch.description.trim();
    }
    if (patch.dueDate !== undefined) {
      const err = requireValidDate(patch.dueDate);
      if (err) return fail(err);
      task.dueDate = patch.dueDate;
    }

    task.updatedAt = this.clock.now().toISOString();
    this.repo.update(task);
    return ok(task);
  }

  submitTask(caller: Caller, taskId: number): ServiceResult<Task> {
    if (caller.role !== "Intern") {
      return fail("Only the assigned intern can submit a task.");
    }
    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    if (normalizeUsername(caller.username) !== task.assigneeUsername) {
      return fail(`Task ${taskId} isn't assigned to you.`);
    }

    if (task.status === "Cancelled") {
      return fail(`Task ${taskId} was cancelled and can't be submitted.`);
    }
    if (task.status === "Submitted") {
      return fail(`Task ${taskId} has already been submitted and is awaiting review.`);
    }
    if (task.status === "Approved") {
      return fail(`Task ${taskId} was already approved.`);
    }
    if (!["Assigned", "InProgress", "NeedsRevision"].includes(task.status)) {
      return fail(`Task ${taskId} can't be submitted from its current status (${task.status}).`);
    }

    task.status = "Submitted";
    task.updatedAt = this.clock.now().toISOString();
    this.repo.update(task);
    return ok(task);
  }

  approveTask(caller: Caller, taskId: number): ServiceResult<Task> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can approve tasks.");
    }
    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    if (task.status === "Approved") {
      return fail(
        `Task ${taskId} was already approved by ${displayName(caller.username)}.`,
      );
    }
    if (task.status !== "Submitted") {
      return fail(
        `Task ${taskId} is still ${task.status}, not yet submitted for review.`,
      );
    }

    task.status = "Approved";
    task.updatedAt = this.clock.now().toISOString();
    this.repo.update(task);
    return ok(task);
  }

  reviseTask(caller: Caller, taskId: number): ServiceResult<Task> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can send tasks back for revision.");
    }
    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    if (task.status === "Approved") {
      return fail(`Task ${taskId} was already approved and can't be revised.`);
    }
    if (task.status !== "Submitted") {
      return fail(
        `Task ${taskId} is still ${task.status}, not yet submitted for review.`,
      );
    }

    task.status = "NeedsRevision";
    task.updatedAt = this.clock.now().toISOString();
    this.repo.update(task);
    return ok(task);
  }

  cancelTask(caller: Caller, taskId: number): ServiceResult<Task> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can cancel tasks.");
    }
    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    if (task.status === "Cancelled") {
      return fail(`Task ${taskId} was already cancelled.`);
    }
    if (task.status === "Approved") {
      return fail(`Task ${taskId} is already Approved and can't be cancelled.`);
    }

    task.status = "Cancelled";
    task.updatedAt = this.clock.now().toISOString();
    this.repo.update(task);
    return ok(task);
  }

  addNote(caller: Caller, taskId: number, text: string): ServiceResult<Task> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can add notes.");
    }
    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    const err = requireNonEmpty(text, "Note text");
    if (err) return fail(err);

    const now = this.clock.now().toISOString();
    const note = {
      text: text.trim(),
      authorUsername: normalizeUsername(caller.username),
      createdAt: now,
    };
    this.repo.insertNote(task.cohortId, task.id, note);
    task.notes.push(note);
    task.updatedAt = now;
    this.repo.update(task);
    return ok(task);
  }

  setBlocked(
    caller: Caller,
    taskId: number,
    reason: string,
  ): ServiceResult<Task> {
    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    const permError = this.requireCanTouchBlockedFlag(caller, task);
    if (permError) return fail(permError);

    if (task.status === "Cancelled" || task.status === "Approved") {
      return fail(
        `Task ${taskId} is ${task.status} and can no longer be flagged as blocked.`,
      );
    }

    const err = requireNonEmpty(reason, "Blocked reason");
    if (err) return fail(err);

    task.blocked = true;
    task.blockedReason = reason.trim();
    task.updatedAt = this.clock.now().toISOString();
    this.repo.update(task);
    return ok(task);
  }

  clearBlocked(caller: Caller, taskId: number): ServiceResult<Task> {
    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    const permError = this.requireCanTouchBlockedFlag(caller, task);
    if (permError) return fail(permError);

    if (!task.blocked) {
      return fail(`Task ${taskId} isn't currently marked blocked.`);
    }

    task.blocked = false;
    task.blockedReason = null;
    task.updatedAt = this.clock.now().toISOString();
    this.repo.update(task);
    return ok(task);
  }

  private requireCanTouchBlockedFlag(
    caller: Caller,
    task: Task,
  ): string | undefined {
    if (caller.role === "HigherUp") return undefined;
    if (normalizeUsername(caller.username) !== task.assigneeUsername) {
      return `Task ${task.id} isn't assigned to you.`;
    }
    return undefined;
  }

  // ---- Reads ------------------------------------------------------------

  /** Full detail view. Auto-transitions Assigned -> InProgress the first
   * time the assigned intern views it (PRD §4). Interns other than the
   * assignee cannot view another intern's task detail (PRD §5). */
  getTask(caller: Caller, taskId: number): ServiceResult<TaskWithFlags> {
    const found = this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    let task = found.value;

    if (
      caller.role === "Intern" &&
      normalizeUsername(caller.username) !== task.assigneeUsername
    ) {
      return fail(
        `Task ${taskId} isn't assigned to you. Try /alltasks for the team overview.`,
      );
    }

    if (
      caller.role === "Intern" &&
      normalizeUsername(caller.username) === task.assigneeUsername &&
      task.status === "Assigned"
    ) {
      task.status = "InProgress";
      task.updatedAt = this.clock.now().toISOString();
      this.repo.update(task);
    }

    return ok(this.withFlags(task));
  }

  listMyTasks(caller: Caller): ServiceResult<TaskWithFlags[]> {
    if (caller.role !== "Intern") {
      return fail("Only interns have a personal /mytasks list.");
    }
    const mine = this.repo
      .listByCohort(caller.cohortId)
      .filter(
        (t) =>
          t.assigneeUsername === normalizeUsername(caller.username) &&
          OPEN_STATUSES.includes(t.status),
      );
    return ok(mine.map((t) => this.withFlags(t)));
  }

  listAllTasks(caller: Caller): ServiceResult<TaskWithFlags[]> {
    const all = this.repo.listByCohort(caller.cohortId);
    return ok(all.map((t) => this.withFlags(t)));
  }

  listPending(caller: Caller): ServiceResult<TaskWithFlags[]> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups have a review queue.");
    }
    const pending = this.repo
      .listByCohort(caller.cohortId)
      .filter((t) => t.status === "Submitted");
    return ok(pending.map((t) => this.withFlags(t)));
  }

  /** Blocked-flag view: cohort-wide for higher-ups (used by the daily/weekly
   * digests, issue #2, and the on-demand /blocked command, issue #6), scoped
   * to just the caller's own tasks for interns — the same
   * scope-by-role-not-reject-interns shape as listBacklog. */
  listBlocked(caller: Caller): ServiceResult<TaskWithFlags[]> {
    const all = this.repo.listByCohort(caller.cohortId);
    const scoped =
      caller.role === "Intern"
        ? all.filter(
            (t) => t.assigneeUsername === normalizeUsername(caller.username),
          )
        : all;
    const blocked = scoped.filter((t) => t.blocked);
    return ok(blocked.map((t) => this.withFlags(t)));
  }

  /** Cohort-wide stats for the dashboard's stats view (issue #4). Higher-up
   * only, same audience gate as the dashboard itself. See `CohortStats` for
   * exact field definitions and the judgment calls behind them. */
  getStats(caller: Caller): ServiceResult<CohortStats> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can view cohort stats.");
    }

    const all = this.repo.listByCohort(caller.cohortId);
    const countable = all.filter((t) => t.status !== "Cancelled");
    const approved = countable.filter((t) => t.status === "Approved");

    const interns = this.roster
      .all()
      .filter((e) => e.role === "Intern" && e.cohortId === caller.cohortId)
      .map((e) => e.username)
      .sort();
    const completedByIntern = new Map<string, number>();
    for (const username of interns) completedByIntern.set(username, 0);
    for (const task of approved) {
      completedByIntern.set(
        task.assigneeUsername,
        (completedByIntern.get(task.assigneeUsername) ?? 0) + 1,
      );
    }
    const completedPerIntern: InternCompletionStats[] = [...completedByIntern.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([username, completed]) => ({ username, completed }));

    const completionRate = countable.length === 0 ? 0 : approved.length / countable.length;

    const submitted = countable.filter((t) => t.status === "Submitted");
    const timesToSubmitHours = submitted.map(
      (t) => (Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / MS_PER_HOUR,
    );
    const averageTimeToSubmitHours =
      timesToSubmitHours.length === 0
        ? null
        : timesToSubmitHours.reduce((sum, h) => sum + h, 0) / timesToSubmitHours.length;

    const now = this.clock.now().getTime();
    const completedThisWeek = approved.filter(
      (t) => now - Date.parse(t.updatedAt) <= MS_PER_WEEK,
    ).length;

    return ok({
      completedPerIntern,
      completionRate,
      averageTimeToSubmitHours,
      completedThisWeek,
    });
  }

  listBacklog(caller: Caller): ServiceResult<TaskWithFlags[]> {
    const all = this.repo.listByCohort(caller.cohortId);
    const scoped =
      caller.role === "Intern"
        ? all.filter(
            (t) => t.assigneeUsername === normalizeUsername(caller.username),
          )
        : all;
    const overdue = scoped
      .map((t) => this.withFlags(t))
      .filter((t) => t.overdue);
    return ok(overdue);
  }

  // ---- Internal helpers ---------------------------------------------

  private withFlags(task: Task): TaskWithFlags {
    const now = this.clock.now();
    return {
      ...task,
      overdue: isOverdue(task, now),
      daysOverdue: isOverdue(task, now) ? daysOverdue(task, now) : 0,
    };
  }

  /** Looks a task up scoped to the caller's cohort, distinguishing
   * "doesn't exist at all" from "exists in a different cohort" only
   * internally — both surface as the same not-found message to the caller,
   * so no cross-cohort information ever leaks out. */
  private mustFindInCallerCohort(
    caller: Caller,
    taskId: number,
  ): ServiceResult<Task> {
    const task = this.repo.findById(caller.cohortId, taskId);
    if (!task) {
      return fail(`Task ${taskId} doesn't exist.`);
    }
    if (!sameCohort(caller, task)) {
      return fail(`Task ${taskId} doesn't exist.`);
    }
    return ok(task);
  }
}

function requireNonEmpty(value: string, label: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return `${label} can't be empty.`;
  }
  return undefined;
}

function requireValidDate(value: string): string | undefined {
  if (!ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    return `"${value}" isn't a valid due date.`;
  }
  return undefined;
}
