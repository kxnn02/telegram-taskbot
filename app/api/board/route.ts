import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";

/**
 * The dashboard board's data source (issue #105 sub-stage 5b): every task
 * in the caller's cohort, joined with its tags via `TagService.listTasksWithTags`
 * (the server-side join this repo does instead of a browser-side Supabase
 * join, ADR-0002/ADR-0006). This is what `components/kanban/kanban-board.tsx`
 * fetches on mount, and re-fetches on reload — so a reorder or a
 * cross-column move survives a reload only insofar as it was actually
 * persisted via `PATCH /api/tasks/[id]` / `PATCH /api/tasks/[id]/order`,
 * not via any client-only state.
 */
export async function GET() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const result = await deps.tagService.listTasksWithTags(caller);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, tasks: result.value });
}
