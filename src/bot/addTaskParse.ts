import { parseDueDate, type ParsedDueDate } from "../date/parseDueDate.js";
import type { TaskPriority } from "../domain/types.js";

export interface AddTaskParsed {
  title: string;
  /** Raw username, `@` stripped, not yet checked against the roster. */
  assigneeUsername?: string;
  /** Undefined means no "by <date>" clause was found — the caller applies
   * the coming-Friday default (issue #27). */
  dueDate?: ParsedDueDate;
  /** Undefined means no `!priority` flag was found — the caller applies
   * the medium default (issue #101). */
  priority?: TaskPriority;
}

export interface AddTaskParseError {
  error: string;
}

export const ADDTASK_USAGE =
  "Usage: /addtask <title> [!priority] [by <date>] [@username], or bare /addtask to use the step-by-step form.";
const USAGE = ADDTASK_USAGE;

// Matches a whole `@username` token anywhere in the string, with the
// surrounding whitespace, so it can be dropped regardless of whether it
// comes before or after a "by <date>" clause (issue #30 — "combine, in
// either order").
const MENTION_RE = /(?:^|\s)@(\w+)(?=\s|$)/;

// Matches a whole `!priority` token anywhere in the string (issue #101),
// same shape as MENTION_RE — stripped before "by"/date parsing so it can't
// be mistaken for part of the title or the date phrase.
const PRIORITY_FLAG_RE = /(?:^|\s)!(\w+)(?=\s|$)/;
const PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];

function parsePriorityWord(word: string): TaskPriority | undefined {
  const lower = word.toLowerCase();
  return (PRIORITIES as readonly string[]).includes(lower) ? (lower as TaskPriority) : undefined;
}

// Every ` by ` occurrence is a candidate split point (issue #49/#51,
// finding F2/D2) — walked last to first below.
const BY_RE = /\s+by\s+/gi;

// Leftover after the matched date phrase must be empty or punctuation
// only, or the split is rejected and title stays whole.
const TRAILING_PUNCTUATION_ONLY_RE = /^[.,!?;:]*$/;

/**
 * Parses a bare `/addtask <args>` string into title/assignee/due-date per
 * issue #27's create grammar. Strips a trailing `@mention` first, then
 * finds a due date only after an explicit `by` keyword (issue #49/#51,
 * finding F2/D2) — scanning the whole string for any date-like phrase
 * (the previous approach) silently truncated titles and invented due
 * dates out of ordinary words like month/weekday abbreviations ("march",
 * "sept", "sat") or time phrases ("at 5").
 *
 * `by` occurrences are walked last to first so
 * "fix the bug found by QA by next Friday" splits on the second "by", and
 * a split is only accepted when the text after it is *entirely* consumed
 * by the date match (plus optional trailing punctuation) — otherwise the
 * next-earlier "by" is tried, and if none qualify the whole string is kept
 * as the title.
 *
 * Two deliberate consequences of the full-consumption rule, kept as-is:
 * "fix login by next Friday please" keeps the whole string as the title
 * (trailing words after the date defeat full consumption — safe, since it
 * never drops user text), and "write the doc by end of week" likewise,
 * because chrono does not parse "end of week".
 *
 * A `!priority` flag (issue #101/#102, e.g. `!urgent`) is stripped the same
 * way as the `@mention`, before the "by" split, so it can never be mistaken
 * for part of the title or the date phrase. An unrecognised word after `!`
 * is a usage error, not a silently-ignored token.
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

  const priorityMatch = text.match(PRIORITY_FLAG_RE);
  let priority: TaskPriority | undefined;
  if (priorityMatch && priorityMatch.index !== undefined) {
    const word = priorityMatch[1]!;
    priority = parsePriorityWord(word);
    if (!priority) {
      return { error: `"${word}" isn't a priority. Use low, medium, high, or urgent.` };
    }
    text = (
      text.slice(0, priorityMatch.index) +
      text.slice(priorityMatch.index + priorityMatch[0].length)
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  if (text.length === 0) {
    return { error: USAGE };
  }

  const byMatches = [...text.matchAll(BY_RE)];
  let title = text;
  let dueDate: ParsedDueDate | undefined;

  for (let i = byMatches.length - 1; i >= 0; i--) {
    const byMatch = byMatches[i]!;
    const matchStart = byMatch.index;
    const matchEnd = matchStart + byMatch[0].length;
    const remainder = text.slice(matchEnd).trim();

    const dateMatch = parseDueDate(remainder, referenceDate);
    if (!dateMatch || dateMatch.index !== 0) continue;

    const leftover = remainder.slice(dateMatch.text.length).trim();
    if (!TRAILING_PUNCTUATION_ONLY_RE.test(leftover)) continue;

    title = text.slice(0, matchStart).trim();
    dueDate = dateMatch;
    break;
  }

  if (title.length === 0) {
    return { error: USAGE };
  }

  return { title, assigneeUsername, dueDate, priority };
}
