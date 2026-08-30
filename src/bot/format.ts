import type { TaskWithFlags } from "../service/taskService.js";
import type { Role } from "../domain/types.js";

export function formatTaskLine(task: TaskWithFlags): string {
  const flags: string[] = [];
  if (task.overdue) flags.push(`OVERDUE ${task.daysOverdue}d`);
  if (task.blocked) flags.push("BLOCKED");
  const flagText = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `#${task.id} ${task.title} — ${task.status} (due ${task.dueDate})${flagText}`;
}

export function formatMyTasks(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "You have no tasks right now.";
  }
  return ["Your open tasks:", ...tasks.map((t) => "- " + formatTaskLine(t))].join(
    "\n",
  );
}

export function formatAllTasksGrouped(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "No tasks in this cohort yet.";
  }
  const byAssignee = new Map<string, TaskWithFlags[]>();
  for (const t of tasks) {
    const list = byAssignee.get(t.assigneeUsername) ?? [];
    list.push(t);
    byAssignee.set(t.assigneeUsername, list);
  }
  const sections = [...byAssignee.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([assignee, list]) => {
      const lines = list.map((t) => "  - " + formatTaskLine(t));
      return `@${assignee}:\n${lines.join("\n")}`;
    });
  return sections.join("\n\n");
}

export function formatPending(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "Nothing pending review right now.";
  }
  return [
    "Awaiting your review:",
    ...tasks.map(
      (t) => `- ${formatTaskLine(t)} (assigned to @${t.assigneeUsername})`,
    ),
  ].join("\n");
}

export function formatBacklog(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "Nothing in the backlog — no overdue tasks.";
  }
  return [
    "Backlog (overdue tasks):",
    ...tasks.map(
      (t) =>
        `- #${t.id} ${t.title} — ${t.daysOverdue} day(s) overdue (assigned to @${t.assigneeUsername})`,
    ),
  ].join("\n");
}

export function formatBlocked(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "Nothing is currently flagged blocked.";
  }
  return [
    "Blocked:",
    ...tasks.map(
      (t) =>
        `- ${formatTaskLine(t)} (assigned to @${t.assigneeUsername}): ${t.blockedReason}`,
    ),
  ].join("\n");
}

export function formatApproved(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "Nothing was approved in the past week.";
  }
  return [
    "Approved this past week:",
    ...tasks.map(
      (t) => `- #${t.id} ${t.title} (@${t.assigneeUsername})`,
    ),
  ].join("\n");
}

export function formatTaskDetail(task: TaskWithFlags): string {
  const flags: string[] = [];
  if (task.overdue) flags.push(`OVERDUE (${task.daysOverdue} day(s))`);
  if (task.blocked) flags.push(`BLOCKED: ${task.blockedReason}`);
  const flagLine = flags.length > 0 ? `\nFlags: ${flags.join(" | ")}` : "";

  const notesText =
    task.notes.length === 0
      ? "No notes yet."
      : task.notes
          .map((n) => `  [${n.createdAt}] @${n.authorUsername}: ${n.text}`)
          .join("\n");

  return [
    `Task ${task.id}: ${task.title}`,
    `Status: ${task.status}${flagLine}`,
    `Assignee: @${task.assigneeUsername}`,
    `Assigned by: @${task.assignedByUsername}`,
    `Due: ${task.dueDate}`,
    "",
    `Description: ${task.description}`,
    "",
    "Notes:",
    notesText,
  ].join("\n");
}

const EVERYONE_HELP = [
  "/start — register yourself against the roster",
  "/help — this list",
  "/cancel — abort an in-progress wizard",
  "/alltasks — every task in the cohort, grouped by assignee",
  "/task <id> — full detail on one task",
  "/backlog — overdue tasks",
  "/blocked — blocked tasks",
];

const INTERN_HELP = [
  "/mytasks — your open tasks",
  "/submit <id> — mark a task submitted",
  "/blocked <id> <reason> — flag a task as blocked",
  "/unblocked <id> — clear the blocked flag",
];

const HIGHER_UP_HELP = [
  "/assign — start the assignment wizard",
  "/pending — review queue (Submitted tasks)",
  "/note <id> <text> — attach a feedback note",
  "/edit <id> — edit a task",
  "/canceltask <id> — cancel a task",
  "/approve <id> / /revise <id> — decide on a submitted task",
  "/dashboard — get the dashboard link",
];

export function formatHelp(role: Role | undefined): string {
  if (!role) {
    return [
      "You're not registered yet.",
      "Run /start to link your Telegram account to the roster.",
    ].join("\n");
  }
  const sections =
    role === "Intern"
      ? [...EVERYONE_HELP, ...INTERN_HELP]
      : [...EVERYONE_HELP, ...HIGHER_UP_HELP];
  return ["Commands available to you:", ...sections.map((l) => "- " + l)].join(
    "\n",
  );
}
