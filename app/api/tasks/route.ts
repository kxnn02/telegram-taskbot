import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";
import { parseCreateTaskRequest } from "../../../src/web/taskMutationRequests";

/**
 * Task creation (Phase 6.2, issue #17 — REST mutation, not a Server Action,
 * per ADR-0008). Deliberately thin: body-shape parsing lives in
 * `taskMutationRequests.ts` (unit-tested directly), the actual business
 * rules (non-empty fields, valid due date, assignee must be a known roster
 * member) all live in and are enforced by `TaskService.assignTask` — this
 * route never reimplements any of them. Open to any roster member, not
 * higher-up-only (ADR-0009 / issue #28): any caller may create a task and
 * assign it to anyone in the cohort, same as the bot's `/addtask`.
 */
export async function POST(request: NextRequest) {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => undefined);
  const parsed = parseCreateTaskRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const result = await deps.service.assignTask(caller, parsed.value);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, task: result.value }, { status: 201 });
}
