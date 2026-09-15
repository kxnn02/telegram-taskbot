import { parseDueDate, type ParsedDueDate } from "../date/parseDueDate.js";

/**
 * `/due <ref> [by] <date>` — single-item form only (issue #222; bulk is a
 * later ticket). `ref` is the raw label the member typed, not yet resolved
 * against any task list — that's `findTaskByRef`'s job, same as
 * `/done`/`/complete`/`/update`.
 */
export interface DueParsed {
  ref: string;
  dueDate: ParsedDueDate;
}

export interface DueParseError {
  error: string;
}

// Same shape as `addTaskParse.ts`'s own constant — kept as a separate literal
// rather than imported, since the two modules are deliberately decoupled
// (see the comment on `parseDueArgs` below).
const TRAILING_PUNCTUATION_ONLY_RE = /^[.,!?;:]*$/;

const LEADING_BY_RE = /^by\s+/i;

/**
 * **Deliberately not `/addtask`'s date walker.** `/addtask` has a free-text
 * title in front of its date, so it has to find the boundary by walking
 * every ` by ` occurrence last-to-first and requiring the date to consume
 * all trailing text (see `addTaskParse.ts` and the repo's trap list — that
 * behaviour must not be "simplified" or reused here).
 *
 * `/due` has no free-text title: everything after the ref is the date. So
 * instead this tries the *shortest* possible ref first — just the first
 * token — and grows it one token at a time until the remainder parses as a
 * full date, stripping one optional leading `by` off the remainder before
 * each attempt. That's what lets a numeric ref (`t21 friday`) resolve on
 * the first try while a multi-word title-keyword ref (`login bug friday`)
 * still works with no `by` at all. Aligning this with `/addtask`'s walker
 * would make `/due t21 friday` ambiguous for no gain.
 *
 * As with `/addtask`, a date match must consume the whole remainder (modulo
 * trailing punctuation) — `/due t21 friday please` is rejected by name
 * rather than silently discarding "please".
 *
 * Returns `undefined` when there aren't even two tokens to split (empty
 * argument, a bare ref with nothing after it, or a bare date with nothing
 * before it) — the caller replies with the usage block for all three, the
 * same way `/update`'s bare-status case does. Returns `{ error }`, naming
 * what was typed, when a ref-like leading token exists but nothing after it
 * resolves to a full date.
 */
export function parseDueArgs(
  raw: string,
  referenceDate: Date = new Date(),
): DueParsed | DueParseError | undefined {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return undefined;

  for (let i = 1; i < tokens.length; i++) {
    const ref = tokens.slice(0, i).join(" ");
    const remainder = tokens.slice(i).join(" ").replace(LEADING_BY_RE, "");

    const dateMatch = parseDueDate(remainder, referenceDate);
    if (!dateMatch || dateMatch.index !== 0) continue;

    const leftover = remainder.slice(dateMatch.text.length).trim();
    if (!TRAILING_PUNCTUATION_ONLY_RE.test(leftover)) continue;

    return { ref, dueDate: dateMatch };
  }

  const rejected = tokens.slice(1).join(" ").replace(LEADING_BY_RE, "");
  return { error: `❌ "${rejected}" doesn't look like a date.` };
}
