import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../../../src/domain/types";
import { getDashboardDeps } from "../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../src/web/requireDashboardSession";
import { DashboardShell } from "../../_components/Shell";
import { SettingsPanel } from "../../../components/settings/settings-panel";

/**
 * The settings page (issue #105 sub-stage 5c) — a thin server component,
 * same shape as `app/dashboard/board/page.tsx`: session-gate, then render
 * the client-side `SettingsPanel`, which does its own data fetching against
 * `/api/settings`. See `SettingsPanel`'s doc comment for exactly what was
 * ported from Devie's real settings page and what was deliberately left out
 * (the bot token/`telegram_config` concept, the webhook-connection and
 * daily-standup cards, and theme switching — sub-stage 5e's job).
 */

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    redirect("/login");
  }
  const typedCaller: Caller = caller;

  return (
    <DashboardShell active="settings" title="Settings" caller={typedCaller}>
      <SettingsPanel />
    </DashboardShell>
  );
}
