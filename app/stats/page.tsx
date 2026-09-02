import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../../src/domain/types";
import { getDashboardDeps } from "../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../src/web/requireDashboardSession";
import { loadStatsView } from "../../src/web/statsView";
import { DashboardShell } from "../_components/Shell";
import { MessageCard } from "../_components/MessageCard";
import { StatsView } from "../_components/StatsView";

/**
 * Stats page (Phase 6.2, issue #17 — originally issue #4). Session-gated
 * the same way as the oversight view; read-only, no mutations. All the
 * actual numbers come straight from `TaskService.getStats` (already
 * higher-up-gated and cohort-scoped there, unrelated to and untouched by
 * R6/#91 opening dashboard *login* to every roster member) — this page
 * just calls it (via `loadStatsView`) and renders the result via
 * `StatsView`/`buildStatsViewModel`. Now that interns can log in, a
 * non-higher-up caller reaching this page gets `getStats`'s refusal back
 * as a normal `ServiceResult`, rendered below as a `MessageCard` like any
 * other refusal, not a crash or a blank page.
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

  const result = await loadStatsView(deps.service, typedCaller);
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
