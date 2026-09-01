import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../../src/domain/types";
import { getDashboardDeps } from "../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../src/web/requireDashboardSession";
import { DashboardShell } from "../_components/Shell";
import { MessageCard } from "../_components/MessageCard";
import { StatsView } from "../_components/StatsView";

/**
 * Stats page (Phase 6.2, issue #17 — originally issue #4). Session-gated
 * the same way as the oversight view; read-only, no mutations. All the
 * actual numbers come straight from `TaskService.getStats` (already
 * higher-up-gated and cohort-scoped there) — this page just calls it and
 * renders the result via `StatsView`/`buildStatsViewModel`.
 */

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    redirect("/login");
  }
  const typedCaller: Caller = caller;

  const result = await deps.service.getStats(typedCaller);
  if (!result.ok) {
    return (
      <DashboardShell active="stats" title="Stats" caller={typedCaller}>
        <MessageCard title="Error" message={result.error} backHref="/" backLabel="Back to dashboard" />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell active="stats" title="Stats" caller={typedCaller}>
      <StatsView stats={result.value} />
    </DashboardShell>
  );
}
