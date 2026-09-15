import { normalizeUsername } from "../domain/roster.js";
import { BULLET_LINE_RE } from "../nlp/parse.js";
import { formatTaskRefHtml } from "./taskRef.js";
import { esc } from "./html.js";
import { PRIORITY_BADGE } from "./format.js";
import { renderDueDate } from "../date/renderDueDate.js";
import { isPastDate } from "../domain/overdue.js";
import type { TaskPriority } from "../domain/types.js";

/**
 * The paste-in bulk task capture path (issue #104), ported from DevieBot's
 * `/addtask` bulk branch (`app/api/telegram/webhook/route.ts:1127-1165` @
 * `632a22c`). Detection and reply formatting live here; `parseBulkTasks`
 * (issue #102, `src/nlp/parse.ts`) does the actual extraction and
 * `TaskService.assignBulkTask` (issue #104) does the loose, unvalidated
 * insert — this module is the glue between them.
 */

/**
 * Gate for routing `/addtask`'s body to the bulk parser (issue #104) instead of
 * the single-task grammar (`createBot.ts:901`). Bulk capture is designed for
 * pasting meeting notes that assign work to people via `@mention`; a mention-free
 * multi-paragraph prose message should not trigger it (see issue #188).
 *
 * Returns true when:
 * - More than one `@mention` is present, OR
 * - A 2+ item bullet/numbered list exists (standalone checklist, no mention needed), OR
 * - An `@mention` is present AND the body has structural hints (newlines or keywords
 *   like `Action Plan:` or `;`-separated segments).
 */
export function shouldTriggerBulkCreate(raw: string): boolean {
  const mentions = [...raw.matchAll(/@(\w+)/g)];
  const hasMultipleMentions = mentions.length > 1;
  const hasAnyMention = mentions.length > 0;

  // A real list stands on its own without a mention: 2+ bullet/numbered lines.
  const bulletLines = raw.split("\n").filter((line) => BULLET_LINE_RE.test(line)).length;
  const hasBulletList = bulletLines >= 2;

  // Structural hints that only mean "bulk" when an assignment is present.
  // NOTE: the blank-line alternative (\n\s*\n) is deliberately dropped from
  // the keyword regex — it is subsumed by hasStructure's newline check.
  const hasKeywordSegments = /(?:Action\s*Plan|Note|Task|Update)\s*:|;\s+/i.test(raw);
  const hasStructure = raw.includes("\n") || hasKeywordSegments;

  return hasMultipleMentions || hasBulletList || (hasAnyMention && hasStructure);
}

/**
 * Devie's only assignee mapping in the bulk insert itself (`route.ts:1143`):
 * `t.assignee === 'unassigned' ? (authorAssignee ?? null) : t.assignee`.
 * `parseBulkTasks` already returns `"unassigned"` exactly when the pasted
 * message had no `@mention` at all to pick up (its `pickAssigneeFromText`
 * fallback) — that's the only case resolved to the message's author.
 * Everything else — including a name that matches no roster member — is
 * passed through unchanged (normalized the same way every other assignee
 * in this bot is): Devie's own loose behaviour, copied on purpose (issue
 * #104: "a name that does not match a member can produce a task nobody
 * owns"). This repo's roster carries no separate display-name or alias
 * fields to resolve through (a roster entry *is* its username), so Devie's
 * alias-table/name-match chain has nothing further to do here.
 */
export function resolveBulkAssignee(rawAssignee: string, callerUsername: string): string {
  const normalized = normalizeUsername(rawAssignee);
  return normalized === "unassigned" ? normalizeUsername(callerUsername) : normalized;
}

export interface BulkCreatedTask {
  id: number;
  title: string;
  assigneeUsername: string;
  dueDate: string | null | undefined;
  priority: TaskPriority;
  description?: string;
}

const URL_RE = /https?:\/\//;

/**
 * Devie's grouped bulk-creation confirmation (`route.ts:1152-1163`), wording
 * and emoji copied verbatim (issue #104 carbon-copy rule 1) — sent with
 * `parse_mode: "HTML"`, the same carve-out `/tasks`/`/standup` already use
 * (#103) for a view copied straight from Devie.
 *
 * Issue #212 (spec #201's shared vocabulary, missed by #207): the
 * identifier renders through the shared monospace `formatTaskRefHtml`, the
 * due date through the shared `renderDueDate` in short form (this is a list
 * of several tasks, not a single-task message like `/addtask`'s own
 * confirmation), and the priority carries the shared `PRIORITY_BADGE` dot.
 * A freshly bulk-created task is never `done`, so "overdue" here is just
 * "due date already in the past" (`isPastDate`) — there's no stored status
 * to consult. `dueDate` can be absent; `renderDueDate` already renders that
 * as an empty string, so the ` · ` separator is only added when there's
 * something to show.
 */
export function formatBulkCreateReply(tasks: BulkCreatedTask[], now: Date): string {
  const grouped = new Map<string, BulkCreatedTask[]>();
  for (const task of tasks) {
    const group = grouped.get(task.assigneeUsername) ?? [];
    group.push(task);
    grouped.set(task.assigneeUsername, group);
  }

  let msg = `✅ <b>${tasks.length} task${tasks.length !== 1 ? "s" : ""} added.</b>\n\n`;
  for (const [assignee, group] of grouped) {
    msg += `@${esc(assignee)}\n`;
    msg += group
      .map((t) => {
        const overdue = t.dueDate ? isPastDate(t.dueDate, now) : false;
        const dueText = renderDueDate(t.dueDate, now, overdue, "short");
        const due = dueText ? ` · ${dueText}` : "";
        const hasLink = t.description && URL_RE.test(t.description) ? " 🔗" : "";
        return `• ${formatTaskRefHtml(t.id)}${PRIORITY_BADGE[t.priority]} ${esc(t.title)}${due}${hasLink}`;
      })
      .join("\n");
    msg += "\n\n";
  }
  return msg.trim();
}
