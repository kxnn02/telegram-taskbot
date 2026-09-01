import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../../../../src/domain/types";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { DashboardShell } from "../../../_components/Shell";
import { MessageCard } from "../../../_components/MessageCard";
import { TaskForm } from "../../../_components/TaskForm";

/**
 * Edit-task page (Phase 6.2, issue #17 — the per-row Edit action explicitly
 * deferred by Phase 6.1). Session-gated the same way as the oversight page.
 * Loads the current task via `TaskService.getTask` purely to prefill the
 * form (and to re-check the Approved-lock, matching
 * `dashboardServer.ts`'s `GET /tasks/:id/edit`) — the actual save happens
 * client-side against `PATCH /api/tasks/:id`, which re-validates everything
 * itself, so a task that changed between this page load and the save still
 * fails safely there rather than here.
 */

export const dynamic = "force-dynamic";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);

  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    redirect("/login");
  }
  const typedCaller: Caller = caller;

  if (!Number.isInteger(taskId)) {
    return (
      <DashboardShell active="tasks" title="Edit task" caller={typedCaller}>
        <MessageCard title="Task not found" message={`"${id}" isn't a valid task id.`} backHref="/" backLabel="Back to dashboard" />
      </DashboardShell>
    );
  }

  const found = await deps.service.getTask(typedCaller, taskId);
  if (!found.ok) {
    return (
      <DashboardShell active="tasks" title="Edit task" caller={typedCaller}>
        <MessageCard title="Task not found" message={found.error} backHref="/" backLabel="Back to dashboard" />
      </DashboardShell>
    );
  }

  // Assignable to any roster member, not just interns (issue #27/#29).
  const assignees = deps.roster
    .all()
    .filter((e) => e.cohortId === typedCaller.cohortId)
    .map((e) => e.username)
    .sort();

  return (
    <DashboardShell active="tasks" title="Edit task" caller={typedCaller}>
      <TaskForm
        mode="edit"
        taskId={taskId}
        interns={assignees}
        initial={{
          assigneeUsername: found.value.assigneeUsername,
          title: found.value.title,
          description: found.value.description,
          dueDateText: found.value.dueDate,
        }}
      />
    </DashboardShell>
  );
}
