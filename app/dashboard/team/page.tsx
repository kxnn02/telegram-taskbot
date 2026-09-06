import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../../../src/domain/types";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";
import { DashboardShell } from "../../_components/Shell";
import { TeamPanel } from "../../../components/team/team-panel";

/**
 * The team page (issue #105 sub-stage 5d) — a thin server component, same
 * shape as `app/dashboard/board/page.tsx`/`app/dashboard/settings/page.tsx`:
 * session-gate, then render the client-side `TeamPanel`, which does its own
 * data fetching against `/api/team`. See `TeamPanel`'s doc comment for
 * exactly what was ported from Devie's real team page and what was
 * deliberately adapted (no role column/grouping — #106 deletes roles; no
 * `name` field — this repo's roster row has none).
 */

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    redirect("/login");
  }
  const typedCaller: Caller = caller;

  return (
    <DashboardShell active="team" title="Team" caller={typedCaller}>
      <TeamPanel />
    </DashboardShell>
  );
}
