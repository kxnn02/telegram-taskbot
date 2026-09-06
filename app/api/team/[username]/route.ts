import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { parseRenameMemberRequest } from "../../../../src/web/teamRequests";

/**
 * Single-member edit/remove (issue #105 sub-stage 5d), one route per
 * resource per ADR-0008, same shape as `app/api/tasks/[id]/route.ts`.
 * `username` is the roster's own key (there's no synthetic member id in
 * this repo's schema — ADR-0003), so it's the route param, URL-decoded
 * before use since Telegram usernames can't contain characters that would
 * need escaping but are passed through `encodeURIComponent` by the client
 * regardless.
 *
 * PATCH renames the member (the only field left to edit once role is gone,
 * ticket decision 3/#106). DELETE removes them outright — there is no
 * "refuse if they hold open tasks" guard here: that rule belonged to the
 * now-superseded ADR-0010 roster-management design (`/roster remove`),
 * which #106 deleted along with every other access-control mechanism: the
 * team page ships fully editable, per the ticket.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const oldUsername = decodeURIComponent(username);

  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => undefined);
  const parsed = parseRenameMemberRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const result = await deps.rosterService.renameMember(caller, oldUsername, parsed.value.username);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const result = await deps.rosterService.removeMember(caller, decodeURIComponent(username));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
