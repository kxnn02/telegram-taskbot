import type { TaskWithFlags } from "../service/taskService.js";
import { groupByMember, taskLine } from "./standupCard.js";
import { esc } from "./html.js";
import { formatTaskLine } from "./format.js";

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

export const NO_OPEN_TASKS_PLAIN = "No open tasks right now.";
export const NO_OPEN_TASKS_HTML = "<i>No open tasks right now.</i>";

export const STANDUP_APPROVERS = "Dom / Jedd";
export const NOTHING_FOR_REVIEW_PLAIN = "Nothing waiting for review right now.";
export const NOTHING_FOR_REVIEW_HTML = "<i>Nothing waiting for review right now.</i>";

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

export function bucketByMember(tasks: TaskWithFlags[]): MemberBuckets[] {
  return groupByMember(tasks)
    .map((group) => {
      const byBucket = new Map<StandupBucket, TaskWithFlags[]>();
      for (const t of group.tasks) {
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

export function renderMemberBucketsHtml(tasks: TaskWithFlags[]): string[] {
  const members = bucketByMember(tasks);
  if (members.length === 0) return ["", NO_OPEN_TASKS_HTML];

  const lines: string[] = [];
  for (const member of members) {
    lines.push("", `👤 <b>@${esc(member.username)}</b>`);
    for (const bucket of member.buckets) {
      lines.push(
        `${STANDUP_BUCKET_EMOJI[bucket.bucket]} <b>${STANDUP_BUCKET_LABEL[bucket.bucket]} (${bucket.tasks.length})</b>`,
      );
      for (const t of bucket.tasks) lines.push(taskLine(t));
    }
  }
  return lines;
}

export function renderMemberBucketsPlain(tasks: TaskWithFlags[]): string[] {
  const members = bucketByMember(tasks);
  if (members.length === 0) return ["", NO_OPEN_TASKS_PLAIN];

  const lines: string[] = [];
  for (const member of members) {
    lines.push("", `👤 @${member.username}`);
    for (const bucket of member.buckets) {
      lines.push(
        `${STANDUP_BUCKET_EMOJI[bucket.bucket]} ${STANDUP_BUCKET_LABEL[bucket.bucket]} (${bucket.tasks.length})`,
      );
      for (const t of bucket.tasks) lines.push("  - " + formatTaskLine(t));
    }
  }
  return lines;
}

export function reviewQueue(tasks: TaskWithFlags[]): TaskWithFlags[] {
  return sortWithinBucket(tasks.filter((t) => t.status === "in_review"));
}

export function renderReviewQueueHtml(tasks: TaskWithFlags[]): string[] {
  const queue = reviewQueue(tasks);
  const lines: string[] = ["", `👀 <b>For Review and Approval — ${STANDUP_APPROVERS}</b>`];
  if (queue.length === 0) {
    lines.push(NOTHING_FOR_REVIEW_HTML);
  } else {
    for (const t of queue) {
      lines.push(
        `${taskLine(t, { showStatus: false })} (@${esc(t.assigneeUsername)})${t.overdue ? " ⚠️" : ""}`,
      );
    }
  }
  return lines;
}

export function renderReviewQueuePlain(tasks: TaskWithFlags[]): string[] {
  const queue = reviewQueue(tasks);
  const lines: string[] = ["", `👀 For Review and Approval — ${STANDUP_APPROVERS}`];
  if (queue.length === 0) {
    lines.push(NOTHING_FOR_REVIEW_PLAIN);
  } else {
    for (const t of queue) {
      lines.push(
        `  - #${t.id} ${t.title} (@${t.assigneeUsername}) — due ${t.dueDate}${t.overdue ? ` [⚠️ OVERDUE ${t.daysOverdue}d]` : ""}`,
      );
    }
  }
  return lines;
}
