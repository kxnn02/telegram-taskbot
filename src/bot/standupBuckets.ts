import type { TaskWithFlags } from "../service/taskService.js";
import { groupByMember, taskLine } from "./standupCard.js";
import { esc } from "./html.js";

/**
 * Issue #165/#166: the person-first standup layout. `bucketOf` sorts every
 * open task into exactly one named bucket — Overdue / Doing / For approval
 * — checked in this order, first match wins (#165 "Bucket rules"). `done`
 * and non-overdue `backlog` tasks fall out of the per-person lists
 * entirely; they only ever show up in the summary line's counts.
 */
export type StandupBucket = "overdue" | "doing" | "for_approval";

export const STANDUP_BUCKET_ORDER: readonly StandupBucket[] = ["overdue", "doing", "for_approval"];

export const STANDUP_BUCKET_LABEL: Record<StandupBucket, string> = {
  overdue: "Overdue",
  doing: "Doing",
  for_approval: "For approval",
};

export const STANDUP_BUCKET_EMOJI: Record<StandupBucket, string> = {
  overdue: "⚠️",
  doing: "🔄",
  for_approval: "👀",
};

export const NO_OPEN_TASKS_HTML = "<i>No open tasks right now.</i>";

export const NOTHING_FOR_REVIEW_HTML = "<i>No tasks waiting for review right now.</i>";

/** Issue #210 (spec #201): a horizontal rule heavier than the light one
 * `tasksPage.ts` already draws elsewhere in the product (`─` × 21) — one of
 * the review queue's five distinguishing devices, and not used anywhere
 * else in the standup card. */
export const REVIEW_QUEUE_RULE = "━".repeat(20);

/** Who the review queue is waiting on, named in the card since #186 and kept
 * by decision when #210 restructured the queue. Plain text, not a mention —
 * real handles would make it ping. */
export const STANDUP_APPROVERS = "Dom / Jedd";

export function bucketOf(task: TaskWithFlags): StandupBucket | undefined {
  if (task.status === "done") return undefined;
  if (task.overdue) return "overdue";
  if (task.status === "in_review") return "for_approval";
  if (task.status === "backlog") return undefined;
  return "doing";
}

export interface MemberBucket {
  bucket: StandupBucket;
  tasks: TaskWithFlags[];
}

export interface MemberBuckets {
  username: string;
  buckets: MemberBucket[];
}

function sortWithinBucket(tasks: TaskWithFlags[]): TaskWithFlags[] {
  return [...tasks].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id,
  );
}

/**
 * Issue #210: `excludeIds` de-duplicates against the review queue — a task
 * listed there (`reviewQueue`) is omitted here, in its owner's bucket,
 * rather than rendered twice (three times, for a task that is both Overdue
 * and in review — the trap this ticket fixes). This governs *rendering*
 * only: `bucketOf` and `standupSummaryLine` are untouched, so an overdue
 * in-review task still counts as Overdue, per the unchanged classification
 * rule.
 */
export function bucketByMember(
  tasks: TaskWithFlags[],
  excludeIds: ReadonlySet<number> = new Set(),
): MemberBuckets[] {
  return groupByMember(tasks)
    .map((group) => {
      const byBucket = new Map<StandupBucket, TaskWithFlags[]>();
      for (const t of group.tasks) {
        if (excludeIds.has(t.id)) continue;
        const bucket = bucketOf(t);
        if (bucket === undefined) continue;
        const list = byBucket.get(bucket) ?? [];
        list.push(t);
        byBucket.set(bucket, list);
      }
      const buckets: MemberBucket[] = STANDUP_BUCKET_ORDER.filter((b) => byBucket.has(b)).map(
        (bucket) => ({ bucket, tasks: sortWithinBucket(byBucket.get(bucket)!) }),
      );
      return { username: group.username, buckets };
    })
    .filter((member) => member.buckets.length > 0);
}

export function standupSummaryLine(tasks: TaskWithFlags[]): string {
  let overdue = 0;
  let doing = 0;
  let forApproval = 0;
  let backlog = 0;
  let done = 0;

  for (const t of tasks) {
    if (t.status === "done") {
      done++;
      continue;
    }
    const bucket = bucketOf(t);
    if (bucket === "overdue") overdue++;
    else if (bucket === "doing") doing++;
    else if (bucket === "for_approval") forApproval++;
    else if (t.status === "backlog") backlog++;
  }

  return `⚠️ ${overdue} overdue · 🔄 ${doing} doing · 👀 ${forApproval} for approval · 📦 ${backlog} backlog · ✅ ${done} done`;
}

export function renderMemberBucketsHtml(tasks: TaskWithFlags[], now: Date): string[] {
  const excludeIds = new Set(reviewQueue(tasks).map((t) => t.id));
  const members = bucketByMember(tasks, excludeIds);
  if (members.length === 0) return ["", NO_OPEN_TASKS_HTML];

  const lines: string[] = [];
  for (const member of members) {
    lines.push("", `👤 <b>@${esc(member.username)}</b>`);
    for (const bucket of member.buckets) {
      lines.push(
        `${STANDUP_BUCKET_EMOJI[bucket.bucket]} <b>${STANDUP_BUCKET_LABEL[bucket.bucket]} (${bucket.tasks.length})</b>`,
      );
      for (const t of bucket.tasks) lines.push(taskLine(t, now));
    }
  }
  return lines;
}

export function reviewQueue(tasks: TaskWithFlags[]): TaskWithFlags[] {
  return sortWithinBucket(tasks.filter((t) => t.status === "in_review"));
}

/** Issue #209 (spec #201): an overdue queued task used to carry both the
 * due date and a trailing `⚠️` flag — a date plus a suffix the reader still
 * had to decode. `taskLine`'s due date now already reads as elapsed time
 * (`3 days ago`) for an overdue task, so the flag is gone; lateness is
 * expressed once, not twice.
 *
 * Issue #210 (spec #201): the queue is set apart by four of its five
 * distinguishing devices — `REVIEW_QUEUE_RULE` (heavier than the light rule
 * `tasksPage.ts` draws elsewhere), an uppercase heading, a count in that
 * heading, and a `<blockquote>` giving the whole section its own vertical
 * rail, present whether the queue is empty or not. The fifth device is the
 * reviewer line, and it names them in plain text rather than @-mentioning
 * them: no real Telegram handle for either reviewer exists anywhere in this
 * codebase, and the ticket's own fallback covers that case. Naming them is
 * what the card did before the restructure (#186), so dropping the names
 * outright would have lost information the cohort already had. It renders
 * only when the queue is non-empty, per the ticket. Swapping in real
 * handles later is a one-line change here. */
export function renderReviewQueueHtml(tasks: TaskWithFlags[], now: Date): string[] {
  const queue = reviewQueue(tasks);
  const lines: string[] = [
    "",
    REVIEW_QUEUE_RULE,
    `👀 <b>FOR REVIEW AND APPROVAL (${queue.length})</b>`,
    "<blockquote>",
  ];
  if (queue.length === 0) {
    lines.push(NOTHING_FOR_REVIEW_HTML);
  } else {
    for (const t of queue) {
      lines.push(`${taskLine(t, now, { showStatus: false })} (@${esc(t.assigneeUsername)})`);
    }
    lines.push(`<i>Waiting on ${STANDUP_APPROVERS}.</i>`);
  }
  lines.push("</blockquote>");
  return lines;
}
