/**
 * Intent-phrase matcher for messages that @-mention the bot instead of using
 * `/addtask` (issue #34, widened to DevieBot's exact phrase set by #103).
 *
 * Deliberately not general intent parsing — see the "why no LLM call"
 * reasoning on #34: with Telegram privacy mode disabled the bot sees every
 * group message, so a loose matcher would create tasks nobody asked for.
 * Issue #103 confirmed Devie was never loose either: it requires the same
 * mention-plus-lead-in shape this file has always had, so #34's reasoning
 * stands and only the phrase set changes.
 */

/**
 * DevieBot's lead-in regex, copied character-for-character from
 * `app/api/telegram/webhook/route.ts:726` @ `632a22c`. Anchored at the start
 * of the text that follows the mention, so ordinary chatter that merely
 * contains one of these words never routes.
 *
 * Two Devie warts are carbon-copied on purpose (issue #103 rule 2: copy the
 * behaviour, bugs included; improvements get proposed separately):
 *
 * 1. The politeness prefixes are a repeating group, not a single optional
 *    one, so "pls can you could you work on X" matches.
 * 2. There is no word boundary after the phrase alternation, so bare `add`
 *    also matches the "add" inside "adding" and leaves "ing X" as the title.
 *
 * `todo` is deliberately absent: #34 accepted it, Devie does not, and #103's
 * delta table removes it.
 */
const MENTION_LEAD_IN_RE = new RegExp(
  "^(?:pls\\s+|please\\s+|can\\s+you\\s+|could\\s+you\\s+)*" +
    "(?:work\\s+on|add\\s+task|new\\s+task|create\\s+task|add)\\s*:?\\s*",
  "i",
);

export type MentionTrigger =
  /** No mention, or a mention with no lead-in phrase after it. The caller
   * must stay completely silent — Devie sends no reply at all here, and
   * neither does this bot since #103 (the old "did you mean to create a
   * task?" nudge is gone). */
  | { kind: "none" }
  /** A lead-in phrase matched but left no title behind (`@bot add task`).
   * Devie answers this with `/addtask`'s usage example, since by then it has
   * already rewritten the message into a bare `/addtask`. */
  | { kind: "usage" }
  | { kind: "addtask"; args: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Looks for an explicit `@<botUsername>` mention anywhere in `text`, then
 * checks whether the text immediately following it starts with one of
 * Devie's lead-in phrases. Everything after the phrase is handed back as
 * `args` for `parseAddTaskArgs` to parse (issue #30's grammar) — mention
 * triggers use exactly the same title/date/assignee grammar as `/addtask`.
 *
 * Whitespace runs in the trailing text are collapsed to single spaces
 * before matching, mirroring the `.replace(/\s+/g, ' ')` Devie applies to
 * the whole message before running the lead-in regex.
 *
 * Returns `{ kind: "none" }` when there is no mention at all *and* when a
 * mention has no recognised phrase after it, whether that mention leads the
 * message ("@bot how's it going") or is embedded in it ("thanks @bot !").
 * Both are silence: this runs against every group message with privacy mode
 * off, and a bot that answers unaddressed chatter is worse than one that
 * misses an informal request (issue #34; confirmed against Devie in #103).
 */
export function parseMentionTrigger(text: string, botUsername: string): MentionTrigger {
  const mentionRe = new RegExp(`(?:^|\\s)@${escapeRegExp(botUsername)}(?=\\s|$|[^\\w])`, "i");
  const match = mentionRe.exec(text);
  if (!match || match.index === undefined) {
    return { kind: "none" };
  }

  const after = text
    .slice(match.index + match[0].length)
    .replace(/\s+/g, " ")
    .trim();
  const leadIn = MENTION_LEAD_IN_RE.exec(after);
  if (!leadIn) {
    return { kind: "none" };
  }

  const args = after.slice(leadIn[0].length).trim();
  if (args.length === 0) {
    return { kind: "usage" };
  }

  return { kind: "addtask", args };
}
