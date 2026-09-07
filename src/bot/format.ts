import { DateTime } from "luxon";
import type { TaskWithFlags } from "../service/taskService.js";
import type { Task, TaskPriority, TaskStatus } from "../domain/types.js";
import { MANILA_ZONE } from "../domain/overdue.js";
import { esc } from "./html.js";

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

/** Devie's bot-layer priority rendering (issue #101, `lib/standup.ts:20`):
 * an emoji badge with a leading space, not the `Low`/`Medium`/`High`/
 * `Urgent` word labels — those belong to the dashboard (#105) only.
 * `medium`/`low` deliberately render nothing at all. */
export const PRIORITY_BADGE: Record<TaskPriority, string> = {
  urgent: " 🔴",
  high: " 🟠",
  medium: "",
  low: "",
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

/** Devie's "no active task found" card (issue #124 stage S1,
 * `route.ts:952`/`:1012`), sent with `parse_mode: "HTML"`. */
export function formatTaskNotFound(input: string): string {
  return [
    `❌ No active task found matching <b>"${esc(input)}"</b>.`,
    "",
    "<i>Use /tasks to see all active tasks.</i>",
  ].join("\n");
}

/** Devie's keyword-lookup disambiguation card (issue #124 stage S1,
 * `route.ts:957-960`, each candidate line from `taskRefLine` at
 * `route.ts:456-460`), sent with `parse_mode: "HTML"`. `command` is
 * whichever of `/done`, `/complete` or `/update` was typed. `{id}` renders
 * as the bare `task_number`, not the `T-001` form — copied from Devie. */
export function formatAmbiguousTaskMatches(
  command: string,
  input: string,
  matches: Task[],
): string {
  return [
    `🔍 Multiple tasks matched <b>"${esc(input)}"</b>:`,
    ...matches.map(
      (t) => `• <b>${t.id}</b> · ${esc(t.title)} (${t.status.replace(/_/g, " ")})`,
    ),
    "",
    "Please be more specific, or use the task number:",
    `<code>${command} &lt;number&gt;</code>`,
  ].join("\n");
}

export function formatTaskLine(task: TaskWithFlags): string {
  const flags: string[] = [];
  if (task.overdue) flags.push(`⚠️ OVERDUE ${task.daysOverdue}d`);
  if (task.status === "blocked") flags.push("🚧 BLOCKED");
  const flagText = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `#${task.id}${PRIORITY_BADGE[task.priority]} ${task.title} — ${STATUS_EMOJI[task.status]} ${statusLabel(task.status)} (due ${task.dueDate})${flagText}`;
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
    `Task ${task.id}${PRIORITY_BADGE[task.priority]}: ${task.title}`,
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
//
// Issue #124 stage S3: Devie's own /help card has no ⚙️ Other section and
// no dedicated Statuses list — just these three sections plus one italic
// Statuses line (see `formatHelp` below). `<role>`/`<title>`/`<ref>`/
// `<status>` are pre-escaped as literal `&lt;...&gt;` here rather than run
// through `esc()` at render time, since they denote a placeholder, not real
// HTML.
const HELP_SECTIONS: { heading: string; lines: string[] }[] = [
  {
    heading: "📋 <b>View</b>",
    lines: [
      "/tasks — browse tasks by member (paginated)",
      // Devie's own View section lists the role filter between the bare
      // command and the member one (`route.ts:741`). Issue #103 item 2 maps
      // <role> onto cohort_id, so the example names a cohort id.
      "/tasks &lt;role&gt; — filter by role (e.g. cohort-5)",
      "/tasks @username — filter by member",
      "/deadlines — show upcoming deadlines",
      "/standup — send the standup report",
    ],
  },
  {
    heading: "➕ <b>Create</b>",
    lines: [
      "/addtask &lt;title&gt; — add a task (defaults to nearest Tue or Thu onsite day)",
      "/addtask &lt;title&gt; by Friday — add a task with a specific deadline",
      "/addtask &lt;title&gt; @username — add a task and assign it to someone",
      '@-mention the bot, "pls work on &lt;title&gt;" — same as /addtask, works in group chats too',
      '@-mention the bot, "add task &lt;title&gt; @username" — tag + assign in one go',
    ],
  },
  {
    heading: "✏️ <b>Update</b>",
    lines: [
      "/done &lt;ref&gt; — mark as in review (e.g. /done 23)",
      "/done t21,t22,t23 — bulk mark as in review",
      "/complete &lt;ref&gt; (or /completed &lt;ref&gt;) — mark as done (e.g. /complete 23)",
      "/complete t21,t22,t23 — bulk mark as done",
      "/update &lt;ref&gt; &lt;status&gt; — single update",
      "/update t21,t22,t23 done — bulk shared status",
      "/update t21 done, t22 review, t23 inprogress — bulk mixed status",
      "/update, one ref+status per line — bulk multiline",
    ],
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

/** Devie's /help card (issue #124 stage S3), sent with `parse_mode: "HTML"`.
 * `/start` is a pure alias for this (`createBot.ts`), so the two must
 * produce byte-identical output. `botDisplayName` is the caller's job to
 * supply — Devie hardcodes its own name, but this repo is deployed under
 * whatever name the cohort's Telegram bot actually carries, so
 * `createBot.ts` passes `bot.botInfo.first_name` rather than a fixed
 * string. */
export function formatHelp(botDisplayName: string): string {
  return [
    `🤖 <b>${botDisplayName} — Available Commands</b>`,
    "",
    ...HELP_SECTIONS.flatMap((section) => [
      section.heading,
      ...section.lines,
      "",
    ]),
    "<i>Statuses: backlog · todo · in progress · in review · blocked · done</i>",
  ].join("\n");
}

// ---- Devie's taskAddedMsg (issue #124 stage S3) --------------------------

/** Devie's `PRIORITY_EMOJI` (issue #124 stage S3) — deliberately distinct
 * from `PRIORITY_BADGE` above, which stays as-is for the standup card and
 * every other view. Used only by `formatTaskAdded`. */
const TASK_ADDED_PRIORITY_EMOJI: Record<TaskPriority, string> = {
  urgent: "🔴",
  high: "🟠",
  medium: "🔵",
  low: "⚪",
};

function capitalizeFirst(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

export interface TaskAddedInput {
  id: number;
  title: string;
  priority: TaskPriority;
  /** Omitted entirely from the reply when absent — kept for symmetry with
   * Devie, even though this repo's own /addtask flow always has one. */
  assigneeUsername?: string;
  /** ISO `yyyy-MM-dd`. Omitted entirely from the reply when absent. */
  dueDate?: string;
}

/** Devie's `taskAddedMsg` (issue #124 stage S3), sent with
 * `parse_mode: "HTML"`. This repo's kept extras (the past-due warning and
 * the couldn't-notify notice) are appended by `createBot.ts`'s addtask
 * handler, after this card's italic closing line — not part of this
 * function. */
export function formatTaskAdded(input: TaskAddedInput): string {
  const dot = TASK_ADDED_PRIORITY_EMOJI[input.priority];
  const lines = [
    `${dot} Task added · ${capitalizeFirst(input.priority)}:`,
    `<b>${esc(input.title)}</b>`,
  ];
  if (input.assigneeUsername) {
    lines.push(`👤 Assigned to: @${esc(input.assigneeUsername)}`);
  }
  if (input.dueDate) {
    const due = DateTime.fromISO(input.dueDate, { zone: MANILA_ZONE }).toFormat("LLL d, yyyy");
    lines.push(`📅 Due: ${due}`);
  }
  lines.push(`🪪 ID: <code>t${input.id}</code>`);
  lines.push("", "<i>Refresh the dashboard to see your changes.</i>");
  return lines.join("\n");
}

// ---- Devie's /done, /complete, /update single-item replies ---------------

export function formatDoneOk(title: string): string {
  return `👀 <b>${esc(title)}</b>\nMoved to In Review.`;
}

export function formatCompleteOk(title: string): string {
  return `✅ <b>${esc(title)}</b>\nMarked as done. Nice work! 🎉`;
}

/** `status` renders with underscores swapped for spaces, per issue #124
 * stage S3 — deliberately not `statusLabel`'s Title Case rendering. */
export function formatUpdateOk(title: string, status: TaskStatus): string {
  const emoji = STATUS_EMOJI[status] ?? "📌";
  return `${emoji} <b>${esc(title)}</b>\nUpdated to: <b>${status.replace(/_/g, " ")}</b>`;
}

// ---- Devie's batch replies (issue #124 stage S3) --------------------------

export interface BatchSuccessLine {
  /** The `T-001` form (`formatTaskRef`). */
  ref: string;
  title: string;
  /** Already-rendered status word, e.g. `"in review"`, `"done"`, or an
   * `/update` batch item's own resolved status word. */
  statusWord: string;
  emoji: string;
  /** `/update`'s `🔗`/`📝` rider sub-lines, pre-rendered with their own
   * leading newlines — `""`/`undefined` for `/done`/`/complete`, whose
   * grammar has no riders. */
  metaSuffix?: string;
}

export interface BatchFailureLine {
  /** The raw ref/label the user typed, not necessarily a valid task ref. */
  ref: string;
  reason: string;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Devie's batch reply shapes (issue #124 stage S3): a per-kind success
 * header and line style, failures grouped at the end under a `⚠️ Skipped`
 * header, and — when nothing at all succeeded — the dedicated
 * "no tasks were updated" block instead of any per-command usage text. */
export function formatBatchReply(
  kind: "done" | "complete" | "update",
  successes: BatchSuccessLine[],
  failures: BatchFailureLine[],
): string {
  if (successes.length === 0) {
    const lines = ["❌ No tasks were updated."];
    for (const f of failures) {
      lines.push(`• <b>${esc(f.ref)}</b> → ${esc(f.reason)}`);
    }
    lines.push("", "<i>Use /tasks to see valid task numbers.</i>");
    return lines.join("\n");
  }

  const header =
    kind === "done"
      ? `👀 <b>Moved ${pluralize(successes.length, "task")} to In Review.</b>`
      : kind === "complete"
        ? `✅ <b>Marked ${pluralize(successes.length, "task")} as done.</b>`
        : `✅ <b>Updated ${pluralize(successes.length, "task")}.</b>`;

  const lines = [header];
  for (const s of successes) {
    lines.push(
      `• ${s.emoji} <code>${s.ref}</code> ${esc(s.title)} → <b>${s.statusWord}</b>${s.metaSuffix ?? ""}`,
    );
  }
  if (failures.length > 0) {
    lines.push("", `⚠️ <b>Skipped ${pluralize(failures.length, "item")}:</b>`);
    for (const f of failures) {
      lines.push(`• <b>${esc(f.ref)}</b> → ${esc(f.reason)}`);
    }
  }
  return lines.join("\n");
}

// ---- Bare-command usage blocks (issue #124 stage S3, Devie verbatim) -----

export const DONE_USAGE = [
  "Usage: <code>/done &lt;number or keyword&gt;</code>",
  "",
  "<b>Examples:</b>",
  "/done 23",
  "/done login bug",
  "/done t21,t22,t23",
  "",
  "<i>Moves tasks to In Review. Use the task number or any words from the title.</i>",
  "<i>To mark as fully done, use /complete instead.</i>",
].join("\n");

export const COMPLETE_USAGE = [
  "Usage: <code>/complete &lt;number or keyword&gt;</code>",
  "",
  "<b>Examples:</b>",
  "/complete 23",
  "/complete login bug",
  "/complete t21,t22,t23",
  "",
  "<i>Marks tasks as done. Use the task number or any words from the title.</i>",
].join("\n");

/** This repo's longer variant of Devie's `/update` usage block (issue #124
 * stage S3): includes the `link:`/`note:` rider example line and both
 * italic closing lines, since this repo carries those riders and Devie's
 * own shorter base variant doesn't. */
export const UPDATE_USAGE = [
  "Usage: <code>/update &lt;number or keyword&gt; &lt;status&gt;</code>",
  "",
  "<b>Examples:</b>",
  "/update 23 in review",
  "/update login blocked",
  "/update t21,t22,t23 done",
  "/update t21 done, t22 review, t23 inprogress",
  "/update t31 done",
  "t30 done",
  "t32 done",
  "/update T-001 done link:https://github.com/... note: ready for QA",
  "",
  "<i>Valid statuses: backlog · todo · in progress · in review · blocked · done</i>",
  "<i>Optionally append <code>link:&lt;url&gt;</code> and/or <code>note:&lt;text&gt;</code>.</i>",
].join("\n");

/** Devie's unknown-command reply (issue #124 stage S3), sent with
 * `parse_mode: "HTML"`. Replaces this bot's old plain-text fallback. */
export const UNKNOWN_COMMAND_REPLY = "❓ Unknown command. Try /help to see what's available.";
