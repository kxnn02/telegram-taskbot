import { DateTime } from "luxon";
import { normalizeUsername } from "../domain/roster.js";
import { formatTaskRef } from "./taskRef.js";

/**
 * The paste-in bulk task capture path (issue #104), ported from DevieBot's
 * `/addtask` bulk branch (`app/api/telegram/webhook/route.ts:1127-1165` @
 * `632a22c`). Detection and reply formatting live here; `parseBulkTasks`
 * (issue #102, `src/nlp/parse.ts`) does the actual extraction and
 * `TaskService.assignBulkTask` (issue #104) does the loose, unvalidated
 * insert — this module is the glue between them.
 */

/** Devie's gate for routing `/addtask`'s body to the bulk parser instead of
 * the single-task grammar (`route.ts:1128-1134`), copied character for
 * character: more than one `@mention`, any newline, or a grouped-segment
 * marker (`Action Plan:`/`Note:`/`Task:`/`Update:`, a `; `-separated list, or
 * a blank-line-separated paragraph). Checked ahead of every other
 * `/addtask` parsing in `createBot.ts`. */
export function shouldTriggerBulkCreate(raw: string): boolean {
  const mentions = [...raw.matchAll(/@(\w+)/g)];
  const hasMultipleMentions = mentions.length > 1;
  const hasNewlines = raw.includes("\n");
  const hasGroupedSegments = /(?:Action\s*Plan|Note|Task|Update)\s*:|;\s+|\n\s*\n/i.test(raw);
  return hasMultipleMentions || hasNewlines || hasGroupedSegments;
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
  dueDate: string;
  description?: string;
}

const URL_RE = /https?:\/\//;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Devie's grouped bulk-creation confirmation (`route.ts:1152-1163`), wording
 * and emoji copied verbatim (issue #104 carbon-copy rule 1) — sent with
 * `parse_mode: "HTML"`, the same carve-out `/tasks`/`/standup` already use
 * (#103) for a view copied straight from Devie.
 */
export function formatBulkCreateReply(tasks: BulkCreatedTask[]): string {
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
        const code = formatTaskRef(t.id);
        const due = ` · ${DateTime.fromISO(t.dueDate).toFormat("LLL d")}`;
        const hasLink = t.description && URL_RE.test(t.description) ? " 🔗" : "";
        return `• <code>${code}</code> ${esc(t.title)}${due}${hasLink}`;
      })
      .join("\n");
    msg += "\n\n";
  }
  return msg.trim();
}
