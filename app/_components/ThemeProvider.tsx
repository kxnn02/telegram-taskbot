"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Thin wrapper around `next-themes`' provider (issue #105 sub-stage 5e) —
 * `next-themes` requires its own provider to be a client component, so
 * this exists only to keep `app/layout.tsx` (a server component) from
 * needing a `"use client"` directive of its own. `attribute="class"` toggles
 * a `.dark` class on `<html>`, matching `app/globals.css`'s
 * `@custom-variant dark (&:is(.dark *))` (shadcn's convention) and the new
 * `.dark` block added to `src/web/styles.ts`'s TOKENS for the legacy
 * hand-rolled stylesheet. `defaultTheme="system"` respects the OS
 * preference until the viewer picks one explicitly via `ThemeToggle`.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
