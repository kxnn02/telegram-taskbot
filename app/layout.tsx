import type { Metadata } from "next";
import type { ReactNode } from "react";
import { STYLESHEET } from "../src/web/styles";

/**
 * Root layout for the Next.js dashboard (Phase 6.1, issue #17). Renders
 * styles.ts's STYLESHEET (fonts + design tokens + component CSS, lifted
 * verbatim from the DEVCON+ design system, PR #10) into one `<style>` tag —
 * the same single source of truth the still-live Express dashboard uses,
 * so there is exactly one place either app's visual output can drift from.
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
