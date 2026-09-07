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
