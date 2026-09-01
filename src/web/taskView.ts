import type { TaskWithFlags } from "../service/taskService.js";

/**
 * Presentation-layer grouping/filtering for the dashboard's oversight view
 * (PRD §9: "filterable and groupable by intern ... and by status"). These
 * functions operate only on TaskWithFlags[] already returned by
 * TaskService.listAllTasks — no DB/repository access here, so there's no
 * parallel query path to drift from the bot's rules (issue #3 acceptance
 * criteria).
 */

export type StatusGroup = "done" | "to-be-reviewed" | "blocked" | "overdue-backlog";

export const STATUS_GROUPS: StatusGroup[] = [
  "done",
  "to-be-reviewed",
  "blocked",
  "overdue-backlog",
];

export function groupByAssignee(
  tasks: TaskWithFlags[],
): Map<string, TaskWithFlags[]> {
  const grouped = new Map<string, TaskWithFlags[]>();
  for (const task of tasks) {
    const existing = grouped.get(task.assigneeUsername);
    if (existing) {
      existing.push(task);
    } else {
      grouped.set(task.assigneeUsername, [task]);
    }
  }
  return grouped;
}

/**
 * Action-first grouping (issue #5 / the dashboard visual redesign): every
 * task lands in exactly one section describing what it needs from a
 * higher-up, not who owns it. Precedence, first match wins — a
 * Submitted-and-overdue task counts as "needs your review", not "overdue",
 * since what it needs from the higher-up is a review; the due date still
 * renders red in the UI, but the grouping itself is about the pending
 * action, not the date.
 */
export type ActionGroup = "needs-review" | "blocked" | "overdue" | "done" | "open";

export const ACTION_GROUPS: ActionGroup[] = ["needs-review", "blocked", "overdue", "done", "open"];

export function groupByAction(tasks: TaskWithFlags[]): Map<ActionGroup, TaskWithFlags[]> {
  const grouped = new Map<ActionGroup, TaskWithFlags[]>(ACTION_GROUPS.map((g) => [g, []]));
  for (const task of tasks) {
    const group = classify(task);
    grouped.get(group)!.push(task);
  }
  return grouped;
}

function classify(task: TaskWithFlags): ActionGroup {
  if (task.status === "in_review") return "needs-review";
  // `done` always lands in Done, even if `overdue` were somehow still true
  // (in practice it never is once a task is closed — see isOverdue — but
  // this keeps the pure function's own invariant explicit rather than
  // relying on that upstream guarantee).
  if (task.status === "done") return "done";
  if (task.status === "blocked") return "blocked";
  if (task.overdue) return "overdue";
  return "open";
}

export function filterByStatusGroup(
  tasks: TaskWithFlags[],
  group: StatusGroup | undefined,
): TaskWithFlags[] {
  switch (group) {
    case "done":
      return tasks.filter((t) => t.status === "done");
    case "to-be-reviewed":
      return tasks.filter((t) => t.status === "in_review");
    case "blocked":
      return tasks.filter((t) => t.status === "blocked");
    case "overdue-backlog":
      return tasks.filter((t) => t.overdue);
    case undefined:
      return tasks;
  }
}
