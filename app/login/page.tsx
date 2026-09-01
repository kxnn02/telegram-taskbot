import { getDashboardDeps } from "../../src/web/nextDashboardDeps";
import { CenteredShell } from "../_components/Shell";
import { Logo } from "../_components/icons";
import { TelegramLoginWidget } from "../_components/TelegramLoginWidget";

/**
 * Login page (Phase 6.1, issue #17 — step 3): faithful port of
 * dashboardServer.ts's renderLoginPage, serving the Telegram Login Widget
 * script pointed at the new Next.js callback route
 * (`/api/auth/telegram/callback`). An `?error=` query param (set by that
 * route on a rejected login) renders as an inline banner instead of a
 * separate error page, since Route Handlers can't render React directly.
 */

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const deps = await getDashboardDeps();
  const params = await searchParams;
  const errorParam = params.error;
  const error = Array.isArray(errorParam) ? errorParam[0] : errorParam;

  return (
    <CenteredShell>
      <div className="card" style={{ textAlign: "center", padding: "40px 36px" }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: "linear-gradient(185deg,#1E2A56,#0C1330)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 22px",
          }}
        >
          <Logo />
        </div>
        <div style={{ font: "700 24px/32px var(--font-sans)", letterSpacing: "-0.02em", color: "#0F172A" }}>
          DEVCON Cohort 5
        </div>
        <div style={{ font: "var(--md3-body-lg)", color: "#64748B", marginTop: 6 }}>Task oversight dashboard</div>
        <div style={{ height: 1, background: "#E2E8F0", margin: "26px 0" }} />
        {error ? (
          <div style={{ font: "var(--md3-body-md)", color: "#C2363B", marginBottom: 16 }}>{error}</div>
        ) : null}
        <div style={{ font: "var(--md3-body-md)", color: "#64748B", marginBottom: 20 }}>
          Higher-ups only. Interns manage their tasks in Telegram.
        </div>
        <TelegramLoginWidget botUsername={deps.botUsername} authUrl="/api/auth/telegram/callback" />
        <div style={{ font: "var(--md3-body-sm)", color: "#94A3B8", marginTop: 18 }}>
          <svg viewBox="0 0 24 24" width={19} height={19} fill="currentColor" style={{ verticalAlign: "middle" }}>
            <path d="M21.7 3.4 2.9 10.6c-.9.35-.9.86-.16 1.08l4.7 1.47 1.8 5.5c.22.6.4.83.83.83.42 0 .6-.19.83-.42l2.28-2.2 4.74 3.5c.87.48 1.5.23 1.72-.8l3.1-14.6c.32-1.27-.48-1.85-1.31-1.5Z" />
          </svg>{" "}
          Sync. Support. Succeed.
        </div>
      </div>
    </CenteredShell>
  );
}
