import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import type { Caller } from "../../src/domain/types";
import { isOverdue, MANILA_ZONE } from "../../src/domain/overdue";
import { formatTaskRef } from "../../src/bot/taskRef";
import { getDashboardDeps } from "../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../src/web/requireDashboardSession";
import { buildOverviewView } from "../../src/web/overviewData";
import { DashboardShell } from "../_components/Shell";

/**
 * Devie's Overview page (`app/dashboard/page.tsx`, issue #124 stage S4) —
 * a thin server component in the same shape as `app/dashboard/board/page.tsx`:
 * session-gate, fetch tasks server-side (no browser-side Supabase client,
 * ADR-0002), then render. Information architecture only — Devie's ambient
 * glow spheres, dot grid and cloud/plane decorations are out of scope
 * (decision D3 on #124).
 */

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    redirect("/login");
  }
  const typedCaller: Caller = caller;

  const result = await deps.tagService.listTasksWithTags(typedCaller);

  if (!result.ok) {
    return (
      <DashboardShell active="overview" title="Overview" caller={typedCaller}>
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardShell>
    );
  }

  const view = buildOverviewView(result.value, new Date());
  const today = DateTime.now().setZone(MANILA_ZONE).toFormat("cccc, LLLL d, yyyy");

  return (
    <DashboardShell active="overview" title="Overview" caller={typedCaller}>
      <div className="flex flex-col gap-6">
        <p className="text-muted-foreground">{today}</p>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
          {view.stats.map((stat) => (
            <div
              key={stat.key}
              className="rounded-xl border p-4"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
              {stat.sub ? <div className="mt-1 text-xs text-muted-foreground">{stat.sub}</div> : null}
            </div>
          ))}
        </div>

        {view.totalTasks > 0 ? (
          <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">Overall Completion</span>
              <span className="text-muted-foreground">{view.donePercent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--muted)" }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${view.donePercent}%`, background: "var(--primary)" }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>0</span>
              <span>{view.totalTasks} total tasks</span>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Recent Tasks</h2>
            <a href="/dashboard/board" className="text-sm text-muted-foreground hover:underline">
              Board →
            </a>
          </div>
          {view.recentTasks.length === 0 ? (
            <p className="text-muted-foreground">No tasks yet</p>
          ) : (
            <div className="flex flex-col gap-2">
              {view.recentTasks.map((task) => {
                const overdue = isOverdue(task, new Date());
                const dueLabel = DateTime.fromISO(task.dueDate, { zone: MANILA_ZONE }).toFormat("MMM d");
                return (
                  <div key={task.id} className="flex items-center justify-between gap-3 py-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{formatTaskRef(task.id)}</span>
                      <span
                        className={
                          task.status === "done"
                            ? "truncate text-muted-foreground line-through"
                            : "truncate"
                        }
                      >
                        {task.title}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 text-sm ${overdue ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {dueLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {view.urgentCount > 0 ? (
          <div
            className="rounded-xl border p-4"
            style={{ background: "var(--card)", borderColor: "var(--destructive)" }}
          >
            <p className="font-medium text-destructive">
              {view.urgentCount} urgent task{view.urgentCount === 1 ? "" : "s"} need attention
            </p>
            <p className="text-sm text-muted-foreground">
              {view.overdueCount > 0
                ? `${view.overdueCount} overdue · Review your boards`
                : "Review your boards"}
            </p>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
