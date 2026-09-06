import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../../src/web/requireDashboardSession";
import { parseSetPriorityRequest } from "../../../../../src/web/taskMutationRequests";

/**
 * Priority write path for the dashboard's task-dialog (issue #105 sub-stage
 * 5b) — not in the original sub-stage 5b route list, added because
 * `TaskService.setPriority`'s own doc comment names this as its intended
 * caller ("this is the parser's (#102) and the dashboard's (#105) write
 * path") and priority is deliberately excluded from `editTask`'s patch
 * (#106/ADR-0013), so `PATCH /api/tasks/[id]` has no way to carry a
 * priority change. See the sub-stage 5b PR body for this call-out.
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
  const parsed = parseSetPriorityRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const result = await deps.service.setPriority(caller, taskId, parsed.value.priority);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, task: result.value });
}
