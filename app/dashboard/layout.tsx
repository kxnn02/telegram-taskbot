import type { ReactNode } from "react";

/**
 * Exists only so `/dashboard` itself resolves (issue #124 stage S4) —
 * Next.js requires a route segment to have a page, and `app/dashboard` had
 * neither a `page.tsx` nor a `layout.tsx` before this. Deliberately does
 * not host `DashboardShell`: every existing dashboard page
 * (`board`/`team`/`settings`/`activity`) already renders the shell itself,
 * and moving it here would touch all four for no functional gain in this
 * stage.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
