import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../../src/web/requireDashboardSession";
import { parseReorderRequest } from "../../../../../src/web/taskMutationRequests";

/**
 * Drag-reorder write path (issue #105 sub-stage 5b): sets a single task's
 * `orderIndex` via `TaskService.setOrderIndex`. The board's drag-end handler
 * calls this once per task whose `orderIndex` changed after
 * `boardView.ts`'s `reorderColumn` recomputes the destination column's
 * sequential indices — i.e. a handful of PATCH calls per drag (via
 * `Promise.all`, same granularity Devie's own `reorderTasks` uses in
 * `hooks/use-tasks.ts:172-177`), not one call per drag.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ ok: false, error: "Invalid task id." }, { status: 400 });
  }

  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => undefined);
  const parsed = parseReorderRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const result = await deps.service.setOrderIndex(caller, taskId, parsed.value.orderIndex);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, task: result.value });
}
