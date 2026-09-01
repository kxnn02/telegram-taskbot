import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { parseEditTaskRequest } from "../../../../src/web/taskMutationRequests";

/**
 * Task editing (Phase 6.2, issue #17 — REST mutation, not a Server Action,
 * per ADR-0008). Deliberately thin, same split as `POST /api/tasks`: body-
 * shape parsing lives in `taskMutationRequests.ts`, business rules (assignee
 * must be a known roster member, valid due date, etc.) all live in and are
 * enforced by `TaskService.editTask`.
 *
 * Also accepts an optional `status` field (issue #27/#29) — one route per
 * resource, per ADR-0008, rather than the now-deleted `/approve` and
 * `/revise` status-specific routes. A status change is dispatched through
 * `TaskService.setStatus` rather than folded into `editTask`'s patch, since
 * `editTask` (stage 1a) has no `status` field and isn't touched here.
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
  const parsed = parseEditTaskRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const { status, ...patch } = parsed.value;

  const editResult = await deps.service.editTask(caller, taskId, patch);
  if (!editResult.ok) {
    return NextResponse.json({ ok: false, error: editResult.error }, { status: 400 });
  }

  let task = editResult.value;
  if (status !== undefined) {
    const statusResult = await deps.service.setStatus(caller, taskId, status);
    if (!statusResult.ok) {
      return NextResponse.json({ ok: false, error: statusResult.error }, { status: 400 });
    }
    task = statusResult.value;
  }

  return NextResponse.json({ ok: true, task });
}
