import { icon as iconMarkup, LOGO } from "../../src/web/styles";

/**
 * Thin React wrappers around styles.ts's pure string helpers (Solar-style
 * outline icons, the DEVCON four-circle mark) — reused as-is rather than
 * re-drawn, so the Next.js app can never drift from the same icon set the
 * (still-live) Express dashboard uses. `dangerouslySetInnerHTML` is safe
 * here: the markup is static, developer-authored SVG, never user input.
 */

export type IconName = Parameters<typeof iconMarkup>[0];

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return <span style={{ display: "flex" }} dangerouslySetInnerHTML={{ __html: iconMarkup(name, size) }} />;
}

export function Logo() {
  return <span style={{ display: "flex" }} dangerouslySetInnerHTML={{ __html: LOGO }} />;
}
