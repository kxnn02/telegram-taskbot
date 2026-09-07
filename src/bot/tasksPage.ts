import type { TaskService, TaskWithFlags } from "../service/taskService.js";
import type { Caller, Note, TaskPriority } from "../domain/types.js";
import { normalizeUsername, type Roster } from "../domain/roster.js";
import { formatTaskRef } from "./taskRef.js";
import { esc } from "./html.js";

/**
 * DevieBot's paged `/tasks` browser (issue #103 items 1 and 2), ported from
 * `DEVCONC4/DevieBot` @ `632a22c`, `app/api/telegram/webhook/route.ts`:
 * `fetchTaskPages` (136), `buildTasksPage` (234) and the `/tasks` handler
 * (833).
 *
 * One page per member, previous/next buttons that wrap around, a filter row,
 * and the whole thing edited in place via `editMessageText`. Page building
 * (`buildTasksPage`) is pure and takes no service; fetching
 * (`fetchTaskPages`) is the only part that touches data — the same split
 * `standup.ts` already uses for `buildStandup`/`formatStandup`.
 *
 * Devie's replies are carbon-copied, HTML markup included, so these messages
 * are the one place in this bot sent with `parse_mode: "HTML"`. Titles and
 * note text go through `esc` for that reason.
 *
 * No permission check of any kind lives here (#103 rule 3, ADR-0013):
 * `fetchTaskPages` reads through `TaskService.listAllTasks`, which is where
 * the cohort boundary is enforced, and the role filter is just a label
 * comparison on data that is already cohort-scoped.
 */

/** Devie's own status vocabulary for this view (`route.ts:117-124`) —
 * Title Case (`To Do`, `In Progress`), unlike `format.ts`'s sentence-case
 * `STATUS_LABELS`, and with no `done` entry at all because the list is
 * non-done only. Kept local rather than folded into `format.ts` so the
 * carbon copy can't drift when this repo's own labels change. */
const TASK_STATUS_EMOJI: Record<string, string> = {
  backlog: "📦",
  todo: "📝",
  in_progress: "🔄",
  in_review: "👀",
  blocked: "🚧",
};
const TASK_STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
};
const TASK_STATUS_ORDER = ["blocked", "in_progress", "in_review", "todo", "backlog"];

/** Devie sorts its task query by `priority` descending, which on a Postgres
 * text column is alphabetical (`urgent`, `medium`, `low`, `high`) rather
 * than by severity. That ordering is an artifact of their column type, not a
 * decision, and the issue does not call for it — so this uses the severity
 * order the four levels actually mean. */
const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface TaskPage {
  /** The member this page belongs to. Devie stores a human display name
   * here; this repo's display name for a person *is* their username, so
   * that's what this holds — rendered with a leading `@`, the way every
   * other reply in this bot names people. */
  name: string;
  /** The member's `cohort_id` — issue #103 item 2 maps Devie's `<role>`
   * onto it. */
  role: string;
  byStatus: Record<string, string[]>;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

export interface TasksFilter {
  /** `"all"`, or a `cohort_id` to restrict the pages to. */
  roleFilter: string;
  /** A normalized username, or `null` for no member filter. */
  assigneeFilter: string | null;
}

/** Prefix on every `/tasks` inline-button payload, so one callback handler
 * can tell a tasks button from a standup one. */
export const TASKS_CALLBACK_PREFIX = "tasks|";

/**
 * Devie's `/tasks [role|@name]` argument grammar (`route.ts:834-845`). The
 * first `@mention` wins and becomes the member filter; otherwise the whole
 * remainder — spaces included — is lowercased into a role filter. There is
 * deliberately no page argument: paging is the inline keyboard's job now.
 */
export function parseTasksFilter(raw: string): TasksFilter {
  const rest = raw.trim();
  const mentioned = [...rest.matchAll(/@(\w+)/g)].map((m) => m[1]!.toLowerCase());
  const assigneeFilter = mentioned.length > 0 ? normalizeUsername(mentioned[0]!) : null;
  const restTrimmed = rest.toLowerCase();
  const roleFilter =
    !assigneeFilter && restTrimmed && !restTrimmed.startsWith("@") ? restTrimmed : "all";
  return { roleFilter, assigneeFilter };
}

/** Reads back a `tasks|<role>|<page>` button payload. `undefined` when the
 * payload isn't a tasks button or carries a non-numeric page, matching
 * Devie's `if (!isNaN(page))` guard. */
export function parseTasksCallback(
  data: string,
): { roleFilter: string; page: number } | undefined {
  if (!data.startsWith(TASKS_CALLBACK_PREFIX)) return undefined;
  const [, roleFilter, pageStr] = data.split("|");
  if (roleFilter === undefined) return undefined;
  const page = Number.parseInt(pageStr ?? "", 10);
  if (Number.isNaN(page)) return undefined;
  return { roleFilter, page };
}

/**
 * Devie's latest-link-and-latest-note lookup (`route.ts:154-166`), reading
 * this repo's `task.notes` where Devie reads `task_comments`. Comments are
 * walked newest-first: the first note whose text is an http(s) URL becomes
 * the link, and the first one that isn't becomes the note.
 *
 * Devie's `else if` is copied as-is, so a *second* URL, seen after the link
 * slot is already filled, lands in the note slot. That is their behaviour,
 * bug or not (#103 rule 2).
 */
function commentMeta(notes: Note[]): { link?: string; note?: string } {
  const current: { link?: string; note?: string } = {};
  const newestFirst = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const n of newestFirst) {
    const content = n.text.trim();
    if (!content) continue;
    if (!current.link && /^https?:\/\//i.test(content)) {
      current.link = content;
    } else if (!current.note) {
      current.note = content;
    }
  }
  return current;
}

/** One task's line on a page (`route.ts:211-217`). */
function taskLine(task: TaskWithFlags): string {
  const code = formatTaskRef(task.id);
  const { link, note } = commentMeta(task.notes);
  const linkPart = link ? ` · <a href="${link}">🔗</a>` : "";
  const notePart = note ? `\n    📝 ${esc(note)}` : "";
  return `  • <code>${code}</code> ${esc(task.title)}${linkPart}${notePart}`;
}

/**
 * Builds one page per member out of the caller's cohort's non-done tasks
 * (`route.ts:136-232`), applying the role and member filters.
 *
 * `allRoles` is the set of roles the filter row offers. Devie collects every
 * distinct role in its whole `members` table; here the equivalent is every
 * distinct `cohort_id` on the roster, restricted to the caller's own — a bot
 * deployment serves exactly one cohort (ADR-0004), and offering another
 * cohort's id as a button would advertise its existence for no benefit,
 * since `TaskService` would return nothing for it anyway.
 */
export async function fetchTaskPages(
  service: TaskService,
  caller: Caller,
  roster: Roster,
  filter: TasksFilter,
): Promise<{ pages: TaskPage[]; allRoles: string[] }> {
  const all = await service.listAllTasks(caller);
  const tasks = (all.ok ? all.value : [])
    .filter((t) => t.status !== "done")
    .sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id - b.id,
    );

  const allRoles = [
    ...new Set(
      roster
        .all()
        .filter((entry) => entry.cohortId === caller.cohortId)
        .map((entry) => entry.cohortId),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const memberBuckets = new Map<string, TaskPage>();
  for (const task of tasks) {
    const name = task.assigneeUsername;
    // Every task in this cohort belongs to this cohort's members, so a
    // page's role is the caller's cohort id. Roster membership is not
    // consulted as a gate — only as the source of the label.
    const role = roster.find(name, caller.cohortId)?.cohortId ?? caller.cohortId;

    if (filter.roleFilter !== "all" && role !== filter.roleFilter) continue;
    if (filter.assigneeFilter && normalizeUsername(name) !== filter.assigneeFilter) continue;

    if (!memberBuckets.has(name)) memberBuckets.set(name, { name, role, byStatus: {} });
    const bucket = memberBuckets.get(name)!;
    (bucket.byStatus[task.status] ??= []).push(taskLine(task));
  }

  const pages = [...memberBuckets.values()].sort((a, b) => {
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return a.name.localeCompare(b.name);
  });

  return { pages, allRoles };
}

/**
 * Renders one page and its inline keyboard (`route.ts:234-288`). Pure: it
 * takes the pages it is given and nothing else, so every page shape —
 * first, middle, last, single, empty, a member with nothing on their page —
 * is directly testable without a store.
 *
 * The nav row appears only when there is more than one page, and its Prev
 * and Next wrap around, so a two-page list's Next on page 2 goes back to
 * page 1. Filter buttons always reset to page 0.
 */
export function buildTasksPage(
  pages: TaskPage[],
  page: number,
  roleFilter: string,
  allRoles: string[],
): { text: string; keyboard: InlineKeyboardMarkup } {
  const total = pages.length;
  const roleDisplay = roleFilter === "all" ? "" : ` — ${roleFilter}`;
  const label = (r: string) => (r === "all" ? "All" : r);
  const filterRow: InlineButton[] = ["all", ...allRoles].map((f) => ({
    text: f === roleFilter ? `· ${label(f)}` : label(f),
    callback_data: `${TASKS_CALLBACK_PREFIX}${f}|0`,
  }));

  if (total === 0) {
    return {
      text: `📋 <b>Tasks${roleDisplay}</b>\n\n<i>No active tasks for this filter.</i>`,
      keyboard: { inline_keyboard: [filterRow] },
    };
  }

  const index = Math.max(0, Math.min(page, total - 1));
  const current = pages[index]!;

  let text = `📋 <b>Tasks${roleDisplay}</b>\n`;
  text += `👤 <b>@${esc(current.name)}</b>  <i>(${index + 1} / ${total})</i>\n`;
  text += `─────────────────────\n`;

  let hasAny = false;
  for (const status of TASK_STATUS_ORDER) {
    const lines = current.byStatus[status];
    if (!lines?.length) continue;
    hasAny = true;
    text += `\n${TASK_STATUS_EMOJI[status]} <i>${TASK_STATUS_LABEL[status]}</i>\n`;
    text += lines.join("\n") + "\n";
  }
  if (!hasAny) text += "\n<i>No active tasks.</i>\n";

  const keyboard: InlineKeyboardMarkup = { inline_keyboard: [filterRow] };
  if (total > 1) {
    const prev = index > 0 ? index - 1 : total - 1;
    const next = index < total - 1 ? index + 1 : 0;
    keyboard.inline_keyboard.push([
      { text: "◀ Prev", callback_data: `${TASKS_CALLBACK_PREFIX}${roleFilter}|${prev}` },
      {
        text: `${index + 1} / ${total}`,
        callback_data: `${TASKS_CALLBACK_PREFIX}${roleFilter}|${index}`,
      },
      { text: "Next ▶", callback_data: `${TASKS_CALLBACK_PREFIX}${roleFilter}|${next}` },
    ]);
  }

  return { text, keyboard };
}
