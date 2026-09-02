import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { editPatchRequiresHigherUp, parseEditTaskRequest } from "../../../../src/web/taskMutationRequests";

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
 *
 * `TaskService.editTask` deliberately has no role check of its own (every
 * roster member may edit, per its own tests) because every *bot* caller of
 * it already gates at the command layer — `/edit` is higher-up-only,
 * checked in `createBot.ts` before `editTask` is ever called. This route is
 * the dashboard's equivalent entry point for those same fields, so it
 * applies the same gate itself (R6/#91) via `editPatchRequiresHigherUp`,
 * leaving the six-status free-set (#27/#28) open to everyone.
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

  if (editPatchRequiresHigherUp(patch) && caller.role !== "HigherUp") {
    return NextResponse.json({ ok: false, error: "Only higher-ups can edit tasks." }, { status: 403 });
  }

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
