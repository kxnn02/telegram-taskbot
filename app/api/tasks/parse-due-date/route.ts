import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { parseDueDate } from "../../../../src/date/parseDueDate";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { parseDueDateTextRequest } from "../../../../src/web/taskMutationRequests";

/**
 * Natural-language due-date parsing for the create/edit task forms (Phase
 * 6.2, issue #17), mirroring the Express dashboard's two-step "parse, then
 * confirm the friendly date, then save" flow (`dashboardServer.ts`'s
 * `POST /tasks/new` step) but as a small REST endpoint the Client Component
 * form calls before showing its confirm step — same `parseDueDate` used by
 * the assignment wizard and the old Express dashboard, not a re-derived
 * parser.
 */
export async function POST(request: NextRequest) {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => undefined);
  const parsed = parseDueDateTextRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const result = parseDueDate(parsed.value.text);
  if (!result) {
    return NextResponse.json(
      {
        ok: false,
        error: `I couldn't understand that date. Try phrases like "next Friday", "in 3 days", or "Sept 5".`,
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, isoDate: result.isoDate, friendly: result.friendly });
}
