import { parseDueDate, type ParsedDueDate } from "../date/parseDueDate.js";

export interface AddTaskParsed {
  title: string;
  /** Raw username, `@` stripped, not yet checked against the roster. */
  assigneeUsername?: string;
  /** Undefined means no "by <date>" clause was found — the caller applies
   * the coming-Friday default (issue #27). */
  dueDate?: ParsedDueDate;
}

export interface AddTaskParseError {
  error: string;
}

const USAGE =
  "Usage: /addtask <title> [by <date>] [@username], or bare /addtask to use the step-by-step form.";

// Matches a whole `@username` token anywhere in the string, with the
// surrounding whitespace, so it can be dropped regardless of whether it
// comes before or after a "by <date>" clause (issue #30 — "combine, in
// either order").
const MENTION_RE = /(?:^|\s)@(\w+)(?=\s|$)/;

/**
 * Parses a bare `/addtask <args>` string into title/assignee/due-date per
 * issue #27's create grammar. Strips a trailing `@mention` first, then
 * hands the remainder to `parseDueDate` and uses its matched span to split
 * the date out of the title — a naive keyword split would wrongly cut
 * titles that legitimately contain the word "by" but have no date clause
 * at all, since `parseDueDate` simply finds nothing in that case and the
 * whole remainder is kept as the title.
 */
export function parseAddTaskArgs(
  raw: string,
  referenceDate: Date = new Date(),
): AddTaskParsed | AddTaskParseError {
  let text = raw.trim();

  const mentionMatch = text.match(MENTION_RE);
  let assigneeUsername: string | undefined;
  if (mentionMatch && mentionMatch.index !== undefined) {
    assigneeUsername = mentionMatch[1];
    text = (
      text.slice(0, mentionMatch.index) +
      text.slice(mentionMatch.index + mentionMatch[0].length)
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  if (text.length === 0) {
    return { error: USAGE };
  }

  const dateMatch = parseDueDate(text, referenceDate);
  let title = text;
  let dueDate: ParsedDueDate | undefined;
  if (dateMatch) {
    title = text
      .slice(0, dateMatch.index)
      .trim()
      .replace(/\s+by$/i, "")
      .trim();
    dueDate = dateMatch;
  }

  if (title.length === 0) {
    return { error: USAGE };
  }

  return { title, assigneeUsername, dueDate };
}
