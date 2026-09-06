import type { Metadata } from "next";
import type { ReactNode } from "react";
import { STYLESHEET } from "../src/web/styles";
import "./globals.css";

/**
 * Root layout for the Next.js dashboard (Phase 6.1, issue #17). Renders
 * styles.ts's STYLESHEET (fonts + design tokens + component CSS, lifted
 * verbatim from the DEVCON+ design system, PR #10) into one `<style>` tag —
 * the same single source of truth the still-live Express dashboard uses,
 * so there is exactly one place either app's visual output can drift from.
 *
 * `./globals.css` (added in issue #105 sub-stage 5a) wires up Tailwind v4 +
 * shadcn/ui for later stages (5b+) — its `@theme` maps the same DEVCON
 * tokens from `src/web/styles.ts` rather than introducing new colors or
 * fonts. It's imported here so `next build` actually processes the
 * Tailwind pipeline (the highest-risk part of this sub-stage), but nothing
 * on this page uses a Tailwind class yet, so there's no visible change.
 */

export const metadata: Metadata = {
  title: "DevCon Cohort 5 Dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&display=swap"
        />
        <style>{STYLESHEET}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
