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

export function filterByStatusGroup(
  tasks: TaskWithFlags[],
  group: StatusGroup | undefined,
): TaskWithFlags[] {
  switch (group) {
    case "done":
      return tasks.filter((t) => t.status === "Approved");
    case "to-be-reviewed":
      return tasks.filter((t) => t.status === "Submitted");
    case "blocked":
      return tasks.filter((t) => t.blocked);
    case "overdue-backlog":
      return tasks.filter((t) => t.overdue);
    case undefined:
      return tasks;
  }
}
