import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";

const PAGE_SIZE = 25;

/**
 * The dedicated activity-log page's data source (issue #105 sub-stage
 * 5e), same thin-route pattern as `app/api/team/route.ts`: no request-body
 * shape to parse (this is a read-only, query-string-paginated GET), so
 * there's no `*Requests.ts` parser here — just query-param coercion,
 * business rules in `ActivityLogService`. Cohort-scoped, open to any
 * roster member (ADR-0013 — no access-control tier anywhere).
 *
 * `?before=<id>` pages backward (older) through the cohort's `audit_logs`
 * rows, keyset-paginated by `id` (see `AuditLogStorePort.listPage`'s doc
 * comment for why `id`, not `created_at`/offset). Distinct from
 * `/api/settings`'s `activity` field, which stays the settings page's own
 * inline, capped-at-50 preview (`SettingsService.listRecentActivity`,
 * unchanged by this route).
 */
export async function GET(request: NextRequest) {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const beforeParam = request.nextUrl.searchParams.get("before");
  const beforeId = beforeParam ? Number.parseInt(beforeParam, 10) : undefined;
  if (beforeParam !== null && (beforeId === undefined || Number.isNaN(beforeId))) {
    return NextResponse.json({ ok: false, error: "Invalid 'before' cursor." }, { status: 400 });
  }

  const result = await deps.activityLogService.listPage(caller, { limit: PAGE_SIZE, beforeId });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, items: result.value.items, hasMore: result.value.hasMore });
}
