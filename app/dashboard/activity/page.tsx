import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../../../src/domain/types";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";
import { DashboardShell } from "../../_components/Shell";
import { ActivityLogPanel } from "../../../components/activity/activity-log-panel";

/**
 * The dedicated activity-log page (issue #105 sub-stage 5e) — a thin
 * server component, same shape as `app/dashboard/settings/page.tsx`:
 * session-gate, then render the client-side `ActivityLogPanel`, which does
 * its own paginated data fetching against `/api/activity`.
 *
 * Separate from the settings page's own inline activity-log preview
 * (`SettingsPanel`, shipped in sub-stage 5c) — that one stays a capped,
 * unpaginated list of the 50 most recent rows; this is the full,
 * paginated history the ticket calls the "dedicated activity-log view".
 */

export const dynamic = "force-dynamic";

export default async function ActivityLogPage() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    redirect("/login");
  }
  const typedCaller: Caller = caller;

  return (
    <DashboardShell active="activity" title="Activity Log" caller={typedCaller}>
      <ActivityLogPanel />
    </DashboardShell>
  );
}
