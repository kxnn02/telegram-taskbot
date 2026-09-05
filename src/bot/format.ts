import { DateTime } from "luxon";
import type { TaskWithFlags } from "../service/taskService.js";
import type { TaskStatus } from "../domain/types.js";
import { MANILA_ZONE } from "../domain/overdue.js";

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

export const STATUS_EMOJI: Record<TaskStatus, string> = {
  in_progress: "🔄",
  in_review: "👀",
  todo: "📝",
  backlog: "📦",
  blocked: "🚧",
  done: "✅",
};

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
  if (task.overdue) flags.push(`⚠️ OVERDUE ${task.daysOverdue}d`);
  if (task.status === "blocked") flags.push("🚧 BLOCKED");
  const flagText = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `#${task.id} ${task.title} — ${STATUS_EMOJI[task.status]} ${statusLabel(task.status)} (due ${task.dueDate})${flagText}`;
}

export function formatMyTasks(tasks: TaskWithFlags[], page = 1): string {
  if (tasks.length === 0) {
    return "You're all clear — no tasks right now.";
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
    // A filter that matched nothing is not the same as an empty cohort
    // (issue #65, finding H9) — `hintPrefix` already carries the filter
    // argument (`@alice`, `intern`) into this branch, so say what actually
    // happened instead of implying the bot lost the cohort's data.
    return hintPrefix ? `No tasks match ${hintPrefix}.` : "No tasks in this cohort yet.";
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
    "Awaiting review:",
    ...tasks.map(
      (t) => `- ${formatTaskLine(t)} (assigned to @${t.assigneeUsername})`,
    ),
  ].join("\n");
}

export function formatBacklog(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "Nothing's overdue — nice.";
  }
  return [
    "Overdue:",
    ...tasks.map(
      (t) =>
        `- ⚠️ #${t.id} ${t.title} — ${t.daysOverdue} day(s) overdue (assigned to @${t.assigneeUsername})`,
    ),
  ].join("\n");
}

export function formatDeadlines(tasks: TaskWithFlags[]): string {
  if (tasks.length === 0) {
    return "Nothing due in the next 7 days.";
  }
  return [
    "Due in the next 7 days:",
    ...tasks.map((t) => `- ⏰ ${formatTaskLine(t)} (assigned to @${t.assigneeUsername})`),
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
    "Marked done this past week:",
    ...tasks.map(
      (t) => `- #${t.id} ${t.title} (@${t.assigneeUsername})`,
    ),
  ].join("\n");
}

/** Renders a note's stored UTC ISO `createdAt` as a short Manila-resolved
 * timestamp (H12) — every other date in the product is Asia/Manila-resolved,
 * and raw UTC instants (millisecond precision, `T`/`Z` separators) stood out
 * as the one exception. Falls back to the raw stored string, rather than the
 * string "Invalid DateTime", when the value can't be parsed. */
function formatNoteTimestamp(createdAt: string): string {
  const dt = DateTime.fromISO(createdAt, { zone: MANILA_ZONE });
  return dt.isValid ? dt.toFormat("LLL d, HH:mm") : createdAt;
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
          .map((n) => `  [${formatNoteTimestamp(n.createdAt)}] @${n.authorUsername}: ${n.text}`)
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

// No access control of any kind (ADR-0013): the bot's command surface now
// matches Devie's one-for-one, so there's one shared list for everyone —
// no role-specific sections, no "restricted to" notes.
const HELP_SECTIONS: { heading: string; lines: string[] }[] = [
  {
    heading: "📋 View",
    lines: [
      "/tasks — browse tasks by member (paginated)",
      "/tasks @username — filter by member",
      "/deadlines — show upcoming deadlines",
      "/standup — send the standup report",
    ],
  },
  {
    heading: "➕ Create",
    lines: [
      "/addtask <title> — add a task (defaults to the coming Friday)",
      "/addtask <title> by Friday — add a task with a specific deadline",
      "/addtask <title> @username — add a task and assign it to someone",
      '@-mention the bot, "pls work on <title>" — same as /addtask, works in group chats too',
      '@-mention the bot, "add task <title> @username" — tag + assign in one go',
    ],
  },
  {
    heading: "✏️ Update",
    lines: [
      "/done <ref> — mark as in review (e.g. /done 23)",
      "/done t21,t22,t23 — bulk mark as in review",
      "/complete <ref> (or /completed <ref>) — mark as done (e.g. /complete 23)",
      "/complete t21,t22,t23 — bulk mark as done",
      "/update <ref> <status> — single update",
      "/update t21,t22,t23 done — bulk shared status",
      "/update t21 done, t22 review, t23 inprogress — bulk mixed status",
      "/update, one ref+status per line — bulk multiline",
    ],
  },
  {
    heading: "🏷️ Statuses",
    lines: [
      "backlog — not yet started",
      "todo — ready to be picked up",
      "in progress — actively being worked on",
      "in review — done, awaiting feedback",
      "blocked — stuck, can't proceed",
      "done — complete",
    ],
  },
  {
    heading: "⚙️ Other",
    lines: ["/start — say hello and register yourself", "/help — this list"],
  },
];

/** Splits a reply into Telegram-sized chunks (issue #55/F8): several
 * unbounded list commands (/standup, /task, /pending, /overdue, /blocked,
 * /deadlines) could otherwise exceed the 4096-character message limit and
 * throw `Bad Request: message is too long`. `limit` defaults to 4000, not
 * 4096, to leave headroom for Telegram's own overhead. The single shared
 * implementation for every chunked reply, including the `/update` batch
 * summary — one rule, one place. */
export function chunkMessage(text: string, limit = 4000): string[] {
  const chunks: string[] = [];
  let current = "";

  function flush() {
    if (current.length > 0) chunks.push(current);
    current = "";
  }

  for (const line of text.split("\n")) {
    if (line.length > limit) {
      flush();
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > limit) {
      flush();
      current = line;
    } else {
      current = candidate;
    }
  }
  flush();

  return chunks.length > 0 ? chunks : [""];
}

export function formatHelp(): string {
  return [
    "Available Commands",
    "",
    ...HELP_SECTIONS.flatMap((section) => [
      section.heading,
      ...section.lines,
      "",
    ]),
  ]
    .join("\n")
    .trimEnd();
}
