import type { TaskWithFlags } from "../service/taskService.js";
import type { Role } from "../domain/types.js";

/** Tasks per page for the paginated list commands (/alltasks, /mytasks) —
 * issue #7. A command-argument page number was chosen over inline
 * Next/Previous buttons: both commands can be run in the group chat by
 * anyone, their output is plain broadcastable text (not a single caller
 * interacting with buttons like Approve/Revise or the /edit field menu),
 * and a page number keeps the reply self-contained and re-runnable instead
 * of depending on a specific message staying editable. */
const PAGE_SIZE = 10;

interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
}

/** Clamps the requested page into [1, totalPages] so an out-of-range page
 * number (e.g. 0, or past the end) degrades gracefully to the nearest valid
 * page instead of erroring or returning an empty page. */
function paginate<T>(items: T[], requestedPage: number, pageSize = PAGE_SIZE): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, totalPages };
}

function paginationFooter(commandName: string, page: number, totalPages: number): string | null {
  if (totalPages <= 1) return null;
  if (page < totalPages) {
    return `Page ${page} of ${totalPages} — send /${commandName} ${page + 1} for more`;
  }
  return `Page ${page} of ${totalPages}.`;
}

export function formatTaskLine(task: TaskWithFlags): string {
  const flags: string[] = [];
  if (task.overdue) flags.push(`OVERDUE ${task.daysOverdue}d`);
  if (task.blocked) flags.push("BLOCKED");
  const flagText = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `#${task.id} ${task.title} — ${task.status} (due ${task.dueDate})${flagText}`;
}

export function formatMyTasks(tasks: TaskWithFlags[], page = 1): string {
  if (tasks.length === 0) {
    return "You have no tasks right now.";
  }
  const paged = paginate(tasks, page);
  const lines = [
    "Your open tasks:",
    ...paged.items.map((t) => "- " + formatTaskLine(t)),
  ];
  const footer = paginationFooter("mytasks", paged.page, paged.totalPages);
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

export function formatAllTasksGrouped(tasks: TaskWithFlags[], page = 1): string {
  if (tasks.length === 0) {
    return "No tasks in this cohort yet.";
  }
  const paged = paginate(tasks, page);
  const byAssignee = new Map<string, TaskWithFlags[]>();
  for (const t of paged.items) {
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
  const footer = paginationFooter("alltasks", paged.page, paged.totalPages);
  return footer ? `${sections.join("\n\n")}\n\n${footer}` : sections.join("\n\n");
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
