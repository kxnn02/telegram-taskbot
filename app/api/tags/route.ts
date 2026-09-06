import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";
import { parseCreateTagRequest } from "../../../src/web/taskMutationRequests";

/**
 * Tag listing/creation (issue #105 sub-stage 5b), same thin-route pattern as
 * `app/api/tasks/route.ts`: body-shape parsing lives in
 * `taskMutationRequests.ts`, business rules (non-empty name, the `#6366f1`
 * default color) live in `TagService.createTag`. Cohort-scoped, open to any
 * roster member (ADR-0013 — no access-control tier anywhere).
 */
export async function GET() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const result = await deps.tagService.listTags(caller);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, tags: result.value });
}

export async function POST(request: NextRequest) {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => undefined);
  const parsed = parseCreateTagRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const result = await deps.tagService.createTag(caller, parsed.value.name, parsed.value.color);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, tag: result.value }, { status: 201 });
}
