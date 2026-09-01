import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../../../src/domain/types";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";
import { DashboardShell } from "../../_components/Shell";
import { TaskForm } from "../../_components/TaskForm";

/**
 * New-task page (Phase 6.2, issue #17 — the "New task" button explicitly
 * deferred by Phase 6.1). Session-gated the same way as the oversight page;
 * the actual create call happens client-side against `POST /api/tasks`
 * (ADR-0008 REST mutation), not here — this Server Component only resolves
 * the caller and the roster's list of interns for the assignee dropdown.
 */

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    redirect("/login");
  }
  const typedCaller: Caller = caller;

  // Assignable to any roster member, not just interns (issue #27/#29).
  const assignees = deps.roster
    .all()
    .filter((e) => e.cohortId === typedCaller.cohortId)
    .map((e) => e.username)
    .sort();

  return (
    <DashboardShell active="tasks" title="New task" caller={typedCaller}>
      <TaskForm mode="create" interns={assignees} />
    </DashboardShell>
  );
}
