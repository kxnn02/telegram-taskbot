import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../../src/web/requireDashboardSession";

/**
 * Approve a submitted task (Phase 6.2, issue #17 — REST mutation, per
 * ADR-0008). No request body — the action is the whole request. All rules
 * (must be Submitted, higher-up-only, etc.) live in and are enforced by
 * `TaskService.approveTask`.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const result = await deps.service.approveTask(caller, taskId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, task: result.value });
}
