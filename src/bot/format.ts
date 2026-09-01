import type { TaskWithFlags } from "../service/taskService.js";
import type { Role, TaskStatus } from "../domain/types.js";

/** Display labels for the six free-set statuses (#27's normative status
 * table) — the only place this vocabulary is spelled out for user-facing
 * text, so every formatter below renders this instead of the raw
 * snake_case stored value. */
const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
};

export function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status];
}

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

function paginationFooter(
  commandName: string,
  page: number,
  totalPages: number,
  hintPrefix = "",
): string | null {
  if (totalPages <= 1) return null;
  const prefix = hintPrefix ? `${hintPrefix} ` : "";
  if (page < totalPages) {
    return `Page ${page} of ${totalPages} — send /${commandName} ${prefix}${page + 1} for more`;
  }
  return `Page ${page} of ${totalPages}.`;
}

export function formatTaskLine(task: TaskWithFlags): string {
  const flags: string[] = [];
  if (task.overdue) flags.push(`OVERDUE ${task.daysOverdue}d`);
  if (task.status === "blocked") flags.push("BLOCKED");
  const flagText = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `#${task.id} ${task.title} — ${statusLabel(task.status)} (due ${task.dueDate})${flagText}`;
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

/** Renders `/tasks` (issue #33; replaces `/alltasks`), grouped by assignee
 * and paginated. `hintPrefix` carries the filter argument (`@alice`,
 * `intern`) into the next-page hint so a filtered result's footer points
 * back at the same filter rather than plain `/tasks <page>`. */
export function formatAllTasksGrouped(
  tasks: TaskWithFlags[],
  page = 1,
  hintPrefix = "",
): string {
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
  const footer = paginationFooter("tasks", paged.page, paged.totalPages, hintPrefix);
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

export function formatDeadlines(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "Nothing due in the next 7 days.";
  }
  return [
    "Due in the next 7 days:",
    ...tasks.map((t) => `- ${formatTaskLine(t)} (assigned to @${t.assigneeUsername})`),
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
  if (task.status === "blocked") flags.push(`BLOCKED: ${task.blockedReason}`);
  const flagLine = flags.length > 0 ? `\nFlags: ${flags.join(" | ")}` : "";

  const notesText =
    task.notes.length === 0
      ? "No notes yet."
      : task.notes
          .map((n) => `  [${n.createdAt}] @${n.authorUsername}: ${n.text}`)
          .join("\n");

  return [
    `Task ${task.id}: ${task.title}`,
    `Status: ${statusLabel(task.status)}${flagLine}`,
    `Assignee: @${task.assigneeUsername}`,
    `Assigned by: @${task.assignedByUsername}`,
    `Due: ${task.dueDate}`,
    "",
    `Description: ${task.description ?? "(none)"}`,
    "",
    "Notes:",
    notesText,
  ].join("\n");
}

// Almost nothing here is role-gated any more (issue #27/#35) — free-set
// statuses and open reads mean one shared list covers both roles. /edit's
// direct-edit form is the sole exception (still restricted to higher-ups,
// issue #27/#31), so it's called out inline instead of living in its own
// role-specific section the way the pre-#27 help text split things.
const EVERYONE_HELP = [
  "/start — register yourself against the roster",
  "/help — this list",
  "/cancel — abort an in-progress wizard",
  "/addtask <title> [by <date>] [@username] — create a task in one line, assigned to you by default, due the coming Friday unless you give a date",
  "/addtask — bare, starts the step-by-step form instead",
  "@-mention the bot with a task description — same as /addtask, works in group chats too",
  "/tasks [page] — every task in the cohort, grouped by assignee",
  "/tasks @username — filter to one member's tasks",
  "/tasks intern|higherup — filter to tasks assigned to that role",
  "/mytasks — your open tasks",
  "/task <ref> — full detail on one task (ref is 23 or t23)",
  "/update <ref> <status> — set a task's status (backlog, todo, in progress, in review, blocked, done); also takes a comma-separated list of refs for a bulk update",
  "/done <ref> — mark a task In review",
  "/complete <ref> — mark a task Done",
  "/overdue — overdue tasks",
  "/pending — review queue (tasks In review)",
  "/deadlines — open tasks due in the next 7 days, soonest first",
  "/standup — on-demand standup report for the cohort",
  "/blocked — blocked tasks",
  "/blocked <ref> <reason> — flag a task as blocked",
  "/unblock <ref> — restore a blocked task to its previous status",
  "/note <ref> <text> — attach a feedback note",
  "/edit <ref> <field> <value> — edit assignee, title, description, or duedate directly (restricted to higher-ups)",
  "/edit <ref> — bare, starts the field-choice form instead (restricted to higher-ups)",
  "/dashboard — get the dashboard link",
];

export function formatHelp(role: Role | undefined): string {
  if (!role) {
    return [
      "You're not registered yet.",
      "Run /start to link your Telegram account to the roster.",
    ].join("\n");
  }
  return ["Commands available to you:", ...EVERYONE_HELP.map((l) => "- " + l)].join(
    "\n",
  );
}
