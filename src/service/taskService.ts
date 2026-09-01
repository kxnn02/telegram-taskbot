import type { TaskRecord, TaskStorePort } from "../storage/taskStorePort.js";
import type { Clock } from "../domain/clock.js";
import { isOverdue, daysOverdue, isDueWithinDays } from "../domain/overdue.js";
import { normalizeUsername, Roster } from "../domain/roster.js";
import {
  fail,
  ok,
  type Caller,
  type Role,
  type ServiceResult,
  type Task,
  type TaskStatus,
} from "../domain/types.js";

export interface AssignTaskInput {
  assigneeUsername: string;
  title: string;
  description?: string;
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
  /** `done`-task count per known roster member in the cohort, including
   * members with zero — covers every roster member, not just interns,
   * since assignment is open to the whole roster (issue #27/#28). Sorted
   * by username. */
  completedPerIntern: InternCompletionStats[];
  /** done / (all tasks) for the cohort. 0 when there are no tasks at all.
   * There is no more `Cancelled` status to exclude from the denominator
   * (issue #27). */
  completionRate: number;
  /** Average hours between createdAt and updatedAt for tasks *currently*
   * in `in_review` status. This is a best-effort approximation:
   * `updatedAt` is a single last-write-wins timestamp, not a status-change
   * history, so it only reflects the actual submission instant for tasks
   * that haven't been edited or reviewed since — which is exactly the
   * currently-`in_review` subset. `null` when there's no such data yet. */
  averageTimeToSubmitHours: number | null;
  /** Count of tasks marked `done` within the last 7 days, taken from
   * `updatedAt`. Since `done` is now reopenable (the Approved edit-lock is
   * gone, issue #27), a task's `updatedAt` on a currently-`done` task is
   * only reliable as "last time anything about it changed", not
   * necessarily the moment it was marked done — an accepted approximation
   * consistent with "done" being a claim rather than a verified fact. */
  completedThisWeek: number;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_WEEK = 7 * 24 * MS_PER_HOUR;

/** Window size for `listDeadlines` (issue #33's `/deadlines`). */
const DEADLINE_WINDOW_DAYS = 7;

/** Every status except `done` — drives `/mytasks` (issue #28's redefinition
 * of the old OPEN_STATUSES, which enumerated the gate-era open statuses). */
const OPEN_STATUSES: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sameCohort(caller: Caller, task: Task): boolean {
  return caller.cohortId === task.cohortId;
}

function displayName(username: string): string {
  return `@${username}`;
}

/** Strips the storage port's optimistic-concurrency bookkeeping off a
 * `TaskRecord` before it's handed back to callers outside this service —
 * `rowVersion` is an implementation detail of the storage seam (ADR-0006),
 * not part of the domain `Task` shape the bot/dashboard/scheduler layers
 * know about. */
function stripVersion(record: TaskRecord): Task {
  const { rowVersion: _rowVersion, ...task } = record;
  return task;
}

/** Applies the `previous_status` lifecycle rules (issue #27) to a status
 * transition, mutating `task` in place: written only on entry to
 * `blocked`, cleared (along with `blockedReason`) on every exit from
 * `blocked`, and never overwritten by re-blocking an already-blocked task. */
function transitionStatus(task: Task, newStatus: TaskStatus): void {
  const wasBlocked = task.status === "blocked";
  const enteringBlocked = newStatus === "blocked" && !wasBlocked;
  const exitingBlocked = wasBlocked && newStatus !== "blocked";
  if (enteringBlocked) {
    task.previousStatus = task.status;
  } else if (exitingBlocked) {
    task.previousStatus = null;
    task.blockedReason = null;
  }
  task.status = newStatus;
}

/**
 * The task-service layer: every business rule in the system lives here as a
 * plain function, independent of Telegram/HTTP. Both the bot layer and the
 * (future) dashboard call into this same layer. See PRD §12 and issue #1's
 * "Implementation Decisions".
 *
 * Talks to the database only through the `TaskStorePort` seam (ADR-0005) —
 * never to SQLite or Supabase directly — so every method here is async and
 * every write goes through `persist`, which surfaces the port's row_version
 * conflict (ADR-0006) as an ordinary `ServiceResult` failure instead of a
 * thrown exception, matching how every other business-rule violation in
 * this file is reported.
 *
 * ADR-0009 / issue #27: the workflow gate is gone. Any roster member may
 * set any status on any task, assign to any roster member, and read any
 * task — all scoped only by cohort, which is a tenancy boundary and stays
 * enforced everywhere below. The dashboard's higher-up-only *audience*
 * gate (who the oversight tool is for) is a separate thing and is not
 * touched here — see `getStats` and `telegramLoginHandler.ts`.
 */
export class TaskService {
  constructor(
    private readonly store: TaskStorePort,
    private readonly roster: Roster,
    private readonly clock: Clock,
  ) {}

  // ---- Mutations -----------------------------------------------------

  async assignTask(caller: Caller, input: AssignTaskInput): Promise<ServiceResult<Task>> {
    const assignee = normalizeUsername(input.assigneeUsername);
    if (!this.roster.isMember(assignee, caller.cohortId)) {
      return fail(
        `${displayName(assignee)} isn't a known roster member in this cohort.`,
      );
    }

    const titleError = requireNonEmpty(input.title, "Title");
    if (titleError) return fail(titleError);
    const dueDateError = requireValidDate(input.dueDate);
    if (dueDateError) return fail(dueDateError);

    const now = this.clock.now().toISOString();
    const id = await this.store.nextId(caller.cohortId);
    const task: Task = {
      id,
      cohortId: caller.cohortId,
      title: input.title.replace(/\s+/g, " ").trim(),
      description: input.description?.trim() ? input.description.trim() : undefined,
      assigneeUsername: assignee,
      assignedByUsername: normalizeUsername(caller.username),
      dueDate: input.dueDate,
      status: "todo",
      notes: [],
      previousStatus: null,
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await this.store.insertTask(task);
    return ok(stripVersion(inserted));
  }

  async editTask(
    caller: Caller,
    taskId: number,
    patch: EditTaskInput,
  ): Promise<ServiceResult<Task>> {
    const found = await this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    if (patch.assigneeUsername !== undefined) {
      const assignee = normalizeUsername(patch.assigneeUsername);
      if (!this.roster.isMember(assignee, caller.cohortId)) {
        return fail(
          `${displayName(assignee)} isn't a known roster member in this cohort.`,
        );
      }
      task.assigneeUsername = assignee;
    }
    if (patch.title !== undefined) {
      const err = requireNonEmpty(patch.title, "Title");
      if (err) return fail(err);
      task.title = patch.title.replace(/\s+/g, " ").trim();
    }
    if (patch.description !== undefined) {
      task.description = patch.description.trim() ? patch.description.trim() : undefined;
    }
    if (patch.dueDate !== undefined) {
      const err = requireValidDate(patch.dueDate);
      if (err) return fail(err);
      task.dueDate = patch.dueDate;
    }

    task.updatedAt = this.clock.now().toISOString();
    return this.persist(task);
  }

  /** Sets a task's status directly — no role check, no legal-transition
   * check: any roster member may set any status on any task in their own
   * cohort (issue #27/#28). Handles the `previous_status` lifecycle when
   * `status` is (or was) `blocked`, same as `setBlocked`/`clearBlocked`;
   * unlike `setBlocked`, a plain `setStatus(..., "blocked")` always records
   * a null `blockedReason` (the `/update <ref> blocked` path). */
  async setStatus(
    caller: Caller,
    taskId: number,
    status: TaskStatus,
  ): Promise<ServiceResult<Task>> {
    const found = await this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    transitionStatus(task, status);
    task.updatedAt = this.clock.now().toISOString();
    return this.persist(task);
  }

  async addNote(caller: Caller, taskId: number, text: string): Promise<ServiceResult<Task>> {
    const found = await this.mustFindInCallerCohort(caller, taskId);
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
    task.notes = [...task.notes, note];
    task.updatedAt = now;
    const result = await this.persist(task);
    if (!result.ok) return result;
    // Accepted consequence: if insertNote throws after persist succeeds,
    // updatedAt is bumped with no note stored — worse than losing the note
    // update, but strictly better than the old ordering, since it fails
    // loudly instead of silently duplicating the note on every retry.
    await this.store.insertNote(task.cohortId, task.id, note);
    return ok({ ...result.value, notes: task.notes });
  }

  /** Sets a task to `blocked` and records an optional reason — the
   * `/blocked <ref> <reason>` path. Any roster member may block any task in
   * their own cohort (issue #27/#28). `previous_status` is stashed only on
   * entry to `blocked`; re-blocking an already-blocked task leaves it
   * untouched. */
  async setBlocked(
    caller: Caller,
    taskId: number,
    reason?: string,
  ): Promise<ServiceResult<Task>> {
    const found = await this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    transitionStatus(task, "blocked");
    task.blockedReason = reason?.trim() ? reason.trim() : null;
    task.updatedAt = this.clock.now().toISOString();
    return this.persist(task);
  }

  /** Restores a blocked task to its `previous_status`, falling back to
   * `todo` when that's null (issue #27/#28) — the `/unblock` path. Any
   * roster member may unblock any task in their own cohort. */
  async clearBlocked(caller: Caller, taskId: number): Promise<ServiceResult<Task>> {
    const found = await this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    const task = found.value;

    if (task.status !== "blocked") {
      return fail(`Task ${taskId} isn't currently marked blocked.`);
    }

    task.status = task.previousStatus ?? "todo";
    task.previousStatus = null;
    task.blockedReason = null;
    task.updatedAt = this.clock.now().toISOString();
    return this.persist(task);
  }

  // ---- Reads ------------------------------------------------------------

  /** Full detail view. A pure read: never writes (issue #27/#28 — the old
   * Assigned -> InProgress auto-transition-on-view is gone, and so is the
   * "an intern can only view their own task" restriction, since read
   * access is open to the whole cohort). */
  async getTask(caller: Caller, taskId: number): Promise<ServiceResult<TaskWithFlags>> {
    const found = await this.mustFindInCallerCohort(caller, taskId);
    if (!found.ok) return fail(found.error);
    return ok(this.withFlags(found.value));
  }

  /** Caller's own open (non-`done`) tasks. Open to any roster member — a
   * `HigherUp` holding an assigned task gets it back from here too, now
   * that assignment isn't intern-only (issue #28's second, separate change
   * to this method). */
  async listMyTasks(caller: Caller): Promise<ServiceResult<TaskWithFlags[]>> {
    const all = await this.store.listTasksByCohort(caller.cohortId);
    const mine = all.filter(
      (t) =>
        t.assigneeUsername === normalizeUsername(caller.username) &&
        OPEN_STATUSES.includes(t.status),
    );
    return ok(mine.map((t) => this.withFlags(t)));
  }

  async listAllTasks(caller: Caller): Promise<ServiceResult<TaskWithFlags[]>> {
    const all = await this.store.listTasksByCohort(caller.cohortId);
    return ok(all.map((t) => this.withFlags(t)));
  }

  /** The review queue: tasks in `in_review`, cohort-wide. Open to any
   * roster member (issue #28 — drops the old higher-up-only gate). */
  async listPending(caller: Caller): Promise<ServiceResult<TaskWithFlags[]>> {
    const all = await this.store.listTasksByCohort(caller.cohortId);
    const pending = all.filter((t) => t.status === "in_review");
    return ok(pending.map((t) => this.withFlags(t)));
  }

  /** Blocked-status view, cohort-wide for every caller regardless of role
   * (issue #28 drops the old scope-by-role-not-reject-interns shape — every
   * roster member sees the whole cohort's blocked tasks). */
  async listBlocked(caller: Caller): Promise<ServiceResult<TaskWithFlags[]>> {
    const all = await this.store.listTasksByCohort(caller.cohortId);
    const blocked = all.filter((t) => t.status === "blocked");
    return ok(blocked.map((t) => this.withFlags(t)));
  }

  /** Cohort-wide stats for the dashboard's stats view (issue #4). Higher-up
   * only — this is the dashboard's audience gate, not a workflow gate, and
   * is unrelated to the workflow gates removed elsewhere in this file. See
   * `CohortStats` for exact field definitions and the judgment calls
   * behind them. */
  async getStats(caller: Caller): Promise<ServiceResult<CohortStats>> {
    if (caller.role !== "HigherUp") {
      return fail("Only higher-ups can view cohort stats.");
    }

    const all = await this.store.listTasksByCohort(caller.cohortId);
    const done = all.filter((t) => t.status === "done");

    const members = this.roster
      .all()
      .filter((e) => e.cohortId === caller.cohortId)
      .map((e) => e.username)
      .sort();
    const completedByMember = new Map<string, number>();
    for (const username of members) completedByMember.set(username, 0);
    for (const task of done) {
      completedByMember.set(
        task.assigneeUsername,
        (completedByMember.get(task.assigneeUsername) ?? 0) + 1,
      );
    }
    const completedPerIntern: InternCompletionStats[] = [...completedByMember.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([username, completed]) => ({ username, completed }));

    const completionRate = all.length === 0 ? 0 : done.length / all.length;

    const inReview = all.filter((t) => t.status === "in_review");
    const timesToSubmitHours = inReview.map(
      (t) => (Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / MS_PER_HOUR,
    );
    const averageTimeToSubmitHours =
      timesToSubmitHours.length === 0
        ? null
        : timesToSubmitHours.reduce((sum, h) => sum + h, 0) / timesToSubmitHours.length;

    const now = this.clock.now().getTime();
    const completedThisWeek = done.filter(
      (t) => now - Date.parse(t.updatedAt) <= MS_PER_WEEK,
    ).length;

    return ok({
      completedPerIntern,
      completionRate,
      averageTimeToSubmitHours,
      completedThisWeek,
    });
  }

  /** Overdue tasks, cohort-wide for every caller regardless of role
   * (issue #28 drops the old scope-by-role-not-reject-interns shape). */
  async listBacklog(caller: Caller): Promise<ServiceResult<TaskWithFlags[]>> {
    const all = await this.store.listTasksByCohort(caller.cohortId);
    const overdue = all.map((t) => this.withFlags(t)).filter((t) => t.overdue);
    return ok(overdue);
  }

  /** One member's tasks, cohort-wide (issue #33's `/tasks @username`).
   * Rejects a username that isn't a roster member of the caller's own
   * cohort — the same message `assignTask`/`editTask` use for an unknown
   * assignee — rather than silently returning an empty list. */
  async listTasksForMember(
    caller: Caller,
    username: string,
  ): Promise<ServiceResult<TaskWithFlags[]>> {
    const normalized = normalizeUsername(username);
    if (!this.roster.isMember(normalized, caller.cohortId)) {
      return fail(
        `${displayName(normalized)} isn't a known roster member in this cohort.`,
      );
    }
    const all = await this.store.listTasksByCohort(caller.cohortId);
    const mine = all.filter((t) => t.assigneeUsername === normalized);
    return ok(mine.map((t) => this.withFlags(t)));
  }

  /** Tasks assigned to any roster member of the given role, cohort-wide
   * (issue #33's `/tasks intern|higherup` — the meaningful filter axis for
   * a single-cohort-per-group deployment, in place of Devie's cohort
   * filter). Role is resolved against the caller's own cohort so a
   * username shared across cohorts (the dry-run reuse, ADR-0004) can't
   * leak the wrong cohort's role assignment into the filter. */
  async listTasksForRole(
    caller: Caller,
    role: Role,
  ): Promise<ServiceResult<TaskWithFlags[]>> {
    const all = await this.store.listTasksByCohort(caller.cohortId);
    const filtered = all.filter(
      (t) => this.roster.find(t.assigneeUsername, caller.cohortId)?.role === role,
    );
    return ok(filtered.map((t) => this.withFlags(t)));
  }

  /** Open (non-`done`) tasks due within the next 7 days, cohort-wide,
   * soonest due date first (issue #33's `/deadlines`). Already-overdue
   * tasks are excluded — that's `/overdue`'s job (see `isDueWithinDays`). */
  async listDeadlines(caller: Caller): Promise<ServiceResult<TaskWithFlags[]>> {
    const all = await this.store.listTasksByCohort(caller.cohortId);
    const now = this.clock.now();
    const upcoming = all
      .filter((t) => isDueWithinDays(t, now, DEADLINE_WINDOW_DAYS))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
    return ok(upcoming.map((t) => this.withFlags(t)));
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

  /** Persists a mutated `TaskRecord` through the storage port, translating
   * the port's row_version conflict outcome (ADR-0006) into the same
   * `ServiceResult` failure shape every other business-rule rejection in
   * this file uses — callers never see the port's conflict type directly. */
  private async persist(task: TaskRecord): Promise<ServiceResult<Task>> {
    const result = await this.store.updateTask(task);
    if (result.outcome === "conflict") {
      return fail(
        `Task ${task.id} was just changed by someone else — reload it and try again.`,
      );
    }
    return ok(stripVersion(result.task));
  }

  /** Looks a task up scoped to the caller's cohort, distinguishing
   * "doesn't exist at all" from "exists in a different cohort" only
   * internally — both surface as the same not-found message to the caller,
   * so no cross-cohort information ever leaks out. */
  private async mustFindInCallerCohort(
    caller: Caller,
    taskId: number,
  ): Promise<ServiceResult<TaskRecord>> {
    const task = await this.store.findTaskById(caller.cohortId, taskId);
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
