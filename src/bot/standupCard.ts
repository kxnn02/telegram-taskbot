import { DateTime } from "luxon";
import type { TaskWithFlags } from "../service/taskService.js";
import { formatTaskRef } from "./taskRef.js";
import { PRIORITY_BADGE, STATUS_EMOJI } from "./format.js";
import { MANILA_ZONE } from "../domain/overdue.js";
import { esc } from "./html.js";

/**
 * Issue #107: the HTML-rendering presentation layer for the standup's
 * *push* card — the message the authenticated push endpoint sends into the
 * cohort group. Deliberately a separate module from `standup.ts`'s
 * `formatStandup`/`formatStandupFiltered`, which stay the plain-text
 * `/standup` in-chat command output established by issue #103 (see this
 * ticket's PR body for the reasoning: the ticket's HTML-rendering
 * requirement is interpreted as scoped to the new push card, not a rewrite
 * of the already-tested in-chat command).
 *
 * `esc`, `taskLine` and `groupByMember` below are Devie's own
 * `lib/standup.ts` helpers (`esc` @ line 59, `taskLine` @ line 95,
 * `groupByMember` @ line 110), carbon-copied per this ticket's rules 1-3.
 */

/** Devie's three Manila-hour greeting bands (`lib/standup.ts:134`), copied
 * verbatim — wording, emoji, spacing. Boundaries are Manila hour `< 12`,
 * `< 17`, else, per the ticket. */
export function greeting(now: Date): string {
  const hour = DateTime.fromJSDate(now, { zone: MANILA_ZONE }).hour;
  if (hour < 12) return "Good morning, team! Let's make today count. 🌅";
  if (hour < 17) return "Good afternoon, team! Here's a quick look at the board. ☀️";
  return "Good evening, team! Here's your end-of-day update. 🌙";
}

export interface TaskLineOptions {
  /** Show the `<code>T-001</code>` task ref. Default true. */
  showCode?: boolean;
  /** Show the trailing status emoji. Default true. */
  showStatus?: boolean;
  /** Show the trailing ` · <due date>`. Default true. */
  showDue?: boolean;
}

function formatShortDate(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: MANILA_ZONE }).toFormat("ccc, LLL d");
}

/**
 * Devie's `taskLine(t, opts)` (`lib/standup.ts:95`):
 * `▸ <code>T-001</code> Title 🔴 🔄 · Fri, Sep 12`. The priority badge
 * (`PRIORITY_BADGE`, `format.ts`) already carries its own leading space, so
 * `medium`/`low` add nothing and `urgent`/`high` add exactly one space
 * before the glyph.
 */
export function taskLine(task: TaskWithFlags, opts: TaskLineOptions = {}): string {
  const showCode = opts.showCode ?? true;
  const showStatus = opts.showStatus ?? true;
  const showDue = opts.showDue ?? true;

  let line = "▸ ";
  if (showCode) line += `<code>${formatTaskRef(task.id)}</code> `;
  line += esc(task.title);
  line += PRIORITY_BADGE[task.priority];
  if (showStatus) line += ` ${STATUS_EMOJI[task.status]}`;
  if (showDue) line += ` · ${formatShortDate(task.dueDate)}`;
  if (task.status === "blocked" && task.blockedReason?.trim()) {
    line += ` — <i>${esc(task.blockedReason)}</i>`;
  }
  return line;
}

export interface MemberGroup {
  username: string;
  tasks: TaskWithFlags[];
}

/**
 * Devie's `groupByMember(tasks)` (`lib/standup.ts:110`): alphabetical by
 * assignee, with `(Unassigned)` always last. This repo's domain has no
 * "unassigned" concept at all — `Task.assigneeUsername` is a required
 * string (issue #27) — so that half of Devie's rule cannot apply here and
 * is deliberately not ported; every task always lands in exactly one named
 * member's group.
 */
export function groupByMember(tasks: TaskWithFlags[]): MemberGroup[] {
  const byUsername = new Map<string, TaskWithFlags[]>();
  for (const t of tasks) {
    const list = byUsername.get(t.assigneeUsername) ?? [];
    list.push(t);
    byUsername.set(t.assigneeUsername, list);
  }
  return [...byUsername.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([username, memberTasks]) => ({ username, tasks: memberTasks }));
}
