import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";
import { parseSaveSettingsRequest } from "../../../src/web/settingsRequests";

const ACTIVITY_LIMIT = 50;

/**
 * The settings page's data source (issue #105 sub-stage 5c), same thin-route
 * pattern as `app/api/tags/route.ts`: body-shape parsing lives in
 * `settingsRequests.ts`, business rules (the save + audit-row write) live in
 * `SettingsService`. Cohort-scoped, open to any roster member (ADR-0013 —
 * no access-control tier anywhere).
 *
 * GET returns the cohort's current group-chat-id setting plus its recent
 * activity log (Devie's own settings page reads both on mount —
 * `fetchConfig`/`fetchAuditLogs`, `:205-215`); POST saves a new
 * group-chat-id and writes the resulting audit row, mirroring Devie's
 * `handleSave` (`:217-236`).
 */
export async function GET() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const [settingsResult, activityResult] = await Promise.all([
    deps.settingsService.getSettings(caller),
    deps.settingsService.listRecentActivity(caller, ACTIVITY_LIMIT),
  ]);
  if (!settingsResult.ok) {
    return NextResponse.json({ ok: false, error: settingsResult.error }, { status: 400 });
  }
  if (!activityResult.ok) {
    return NextResponse.json({ ok: false, error: activityResult.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    groupChatId: settingsResult.value.groupChatId ?? "",
    activity: activityResult.value,
  });
}

export async function POST(request: NextRequest) {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => undefined);
  const parsed = parseSaveSettingsRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const saveResult = await deps.settingsService.saveGroupChatId(caller, parsed.value.groupChatId);
  const activityResult = await deps.settingsService.listRecentActivity(caller, ACTIVITY_LIMIT);
  if (!saveResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: saveResult.error,
        activity: activityResult.ok ? activityResult.value : [],
      },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    activity: activityResult.ok ? activityResult.value : [],
  });
}
