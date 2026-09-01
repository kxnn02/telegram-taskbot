import type { TaskStatus } from "../domain/types.js";

/**
 * The "accepted in commands" column of #27's normative status table —
 * every word/phrase `/update <ref> <status>` recognises, mapped to the
 * stored value. This table is the spec: it's tested exhaustively (issue
 * #31 acceptance criteria) rather than sampled, so drift here is never
 * silent.
 */
const STATUS_WORDS: Record<string, TaskStatus> = {
  backlog: "backlog",
  todo: "todo",
  "to-do": "todo",
  inprogress: "in_progress",
  "in-progress": "in_progress",
  "in progress": "in_progress",
  wip: "in_progress",
  review: "in_review",
  inreview: "in_review",
  "in-review": "in_review",
  "in review": "in_review",
  blocked: "blocked",
  done: "done",
  complete: "done",
  completed: "done",
};

/** Human-readable list of accepted status words, for the "unrecognised
 * status word" error reply — issue #31 flags this as the most likely user
 * error in the whole spec, so the text matters more than usual. */
export const VALID_STATUS_WORDS_TEXT =
  "backlog, todo, in progress, in review, blocked, done";

export function parseStatusWord(raw: string): TaskStatus | undefined {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return STATUS_WORDS[normalized];
}
