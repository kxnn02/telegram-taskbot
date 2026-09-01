/**
 * Fixed intent-phrase set the bot recognises after an explicit @-mention
 * (issue #34). Deliberately not general intent parsing — see the "why no
 * LLM call" reasoning on #34: with Telegram privacy mode disabled the bot
 * sees every group message, so a loose matcher would create tasks nobody
 * asked for.
 */
const INTENT_PHRASES = ["pls work on", "please work on", "add task", "new task", "todo"];

export type MentionTrigger =
  | { kind: "none" }
  | { kind: "unrecognized" }
  | { kind: "addtask"; args: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Looks for an explicit `@<botUsername>` mention anywhere in `text`, then
 * checks whether the text immediately following it starts with one of the
 * fixed intent phrases. Everything after the phrase is handed back as
 * `args` for `parseAddTaskArgs` to parse (issue #30's grammar) — mention
 * triggers use exactly the same title/date/assignee grammar as `/addtask`.
 *
 * Returns `{ kind: "none" }` when there is no mention at all, or when the
 * mention is embedded mid-message with no recognised intent phrase after
 * it (e.g. "thanks @bot !") — the caller must do nothing in that case,
 * silently, since with privacy mode off this runs against every group
 * message. `{ kind: "unrecognized" }` is reserved for a mention that leads
 * the (trimmed) message, so a reply is only sent when the message reads as
 * addressed to the bot.
 */
export function parseMentionTrigger(text: string, botUsername: string): MentionTrigger {
  const mentionRe = new RegExp(`(?:^|\\s)@${escapeRegExp(botUsername)}(?=\\s|$|[^\\w])`, "i");
  const match = mentionRe.exec(text);
  if (!match || match.index === undefined) {
    return { kind: "none" };
  }

  const after = text.slice(match.index + match[0].length).trim();
  const lower = after.toLowerCase();
  const phrase = INTENT_PHRASES.find(
    (p) => lower === p || lower.startsWith(`${p} `),
  );
  if (!phrase) {
    const leadingMatch = mentionRe.exec(text.trim());
    const isLeading = leadingMatch !== null && leadingMatch.index === 0;
    return isLeading ? { kind: "unrecognized" } : { kind: "none" };
  }

  const args = after.slice(phrase.length).trim();
  if (args.length === 0) {
    return { kind: "unrecognized" };
  }

  return { kind: "addtask", args };
}
