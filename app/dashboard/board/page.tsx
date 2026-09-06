import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../../../src/domain/types";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";
import { DashboardShell } from "../../_components/Shell";
import { KanbanBoard } from "../../../components/kanban/kanban-board";

/**
 * The board page (issue #105 sub-stage 5b) — a thin server component:
 * session-gate exactly like `app/page.tsx`/`app/tasks/new/page.tsx`, then
 * render the client-side `KanbanBoard`, which does its own data fetching
 * against `/api/board` and `/api/tags`. Settings, team, theme switching, and
 * activity-log views are deliberately out of scope for this stage (decision
 * 6) — this page adds only a "Board" nav entry to the existing sidebar, not
 * a redesigned IA.
 */

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    redirect("/login");
  }
  const typedCaller: Caller = caller;

  const assignees = deps.roster
    .all()
    .filter((e) => e.cohortId === typedCaller.cohortId)
    .map((e) => e.username)
    .sort();

  return (
    <DashboardShell active="board" title="Board" caller={typedCaller}>
      <KanbanBoard assignees={assignees} />
    </DashboardShell>
  );
}
