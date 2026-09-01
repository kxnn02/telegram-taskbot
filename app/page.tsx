import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../src/domain/types";
import { verifySession } from "../src/web/sessionCookie";
import { getDashboardDeps } from "../src/web/nextDashboardDeps";
import { loadOversightView } from "../src/web/oversightData";
import { DashboardShell } from "./_components/Shell";
import { Controls } from "./_components/Controls";
import { StatusChips } from "./_components/StatusChips";
import { ActionSections } from "./_components/ActionSections";
import { InternPanels } from "./_components/InternPanels";
import { MessageCard } from "./_components/MessageCard";

/**
 * The read-only oversight view (Phase 6.1, issue #17 — step 4). Session
 * check + data-fetching/filtering are delegated to already-tested pure
 * functions (`verifySession`, `loadOversightView`); this Server Component
 * is a thin render layer on top, same split as `api/telegram/webhook.ts`
 * vs `webhookHandler.ts`. No create/edit/approve here — that's Phase 6.2 —
 * so the "New task" button and per-row Edit action from the Express
 * dashboard are both intentionally dropped, not stubbed.
 */

const SESSION_COOKIE = "session";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OversightPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const deps = await getDashboardDeps();

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SESSION_COOKIE)?.value;
  const verified = cookieValue ? verifySession(cookieValue, deps.sessionSecret) : undefined;
  if (!verified || !verified.ok) {
    redirect("/login");
  }
  const caller: Caller = verified.session;

  const params = await searchParams;
  const result = await loadOversightView(deps.service, caller, {
    status: firstValue(params.status),
    assignee: firstValue(params.assignee),
    group: firstValue(params.group),
  });

  if (!result.ok) {
    return (
      <DashboardShell active="tasks" title="Task oversight" caller={caller}>
        <MessageCard title="Error" message={result.error} backHref="/" backLabel="Back to dashboard" />
      </DashboardShell>
    );
  }

  const { tasks, allTasks, groupMode, statusGroup, assignee } = result.value;
  const assignees = [...new Set(allTasks.map((t) => t.assigneeUsername))].sort();

  return (
    <DashboardShell active="tasks" title="Task oversight" caller={caller}>
      <Controls groupMode={groupMode} assignees={assignees} activeAssignee={assignee} />
      {groupMode === "intern" ? <StatusChips activeStatus={statusGroup} /> : null}
      {groupMode === "action" ? <ActionSections tasks={tasks} /> : <InternPanels tasks={tasks} />}
    </DashboardShell>
  );
}
