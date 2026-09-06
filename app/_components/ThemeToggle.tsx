"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/**
 * Light/dark toggle for the dashboard shell (issue #105 sub-stage 5e),
 * rendered once in `Topbar` so it's available on every page. Uses
 * `next-themes`' own `useTheme()` hook rather than hand-rolled
 * localStorage/`prefers-color-scheme` logic — there is no bespoke
 * "theme-preference persistence logic" here for the ticket's TDD note to
 * apply to; `next-themes` already owns storing and applying the choice
 * (as the `.dark` class on `<html>`, matching `app/globals.css`'s
 * `@custom-variant dark (&:is(.dark *))` and the new dark-mode block in
 * `src/web/styles.ts`'s TOKENS).
 *
 * `mounted` guards against a hydration mismatch: the server always renders
 * with no known theme (next-themes resolves the stored/system preference
 * only after mount), so the icon button renders empty until the client has
 * caught up — same pattern next-themes' own docs recommend.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <span style={{ width: 36, height: 36, display: "inline-block" }} />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="btn ghost sm"
      style={{ padding: 8 }}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
