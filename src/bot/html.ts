/**
 * The one shared HTML-escape helper (issue #124 stage S3), replacing four
 * duplicated copies of the same three `.replace()` calls that had grown up
 * independently across `bulkTaskCreate.ts`, `fanOut.ts`, `tasksPage.ts` and
 * `format.ts` (private) and `standupCard.ts` (exported). Order matters: `&`
 * must be escaped first, or the `&` introduced by escaping a `<`/`>` would
 * itself get escaped a second time.
 */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * `esc`, plus `"` -> `&quot;` (issue #202). For the one spot in this
 * codebase that interpolates a value into an HTML *attribute* — a note's
 * URL inside `href="..."` — rather than element text: a raw `"` there
 * closes the attribute early and breaks the tag, which is what let one
 * task's malformed link take down a member's entire `/tasks` page.
 * `esc` itself is left alone since every other call site escapes element
 * text, where a literal `"` is harmless.
 */
export function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}
