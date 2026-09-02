import type { ReactNode } from "react";
import type { Caller } from "../../src/domain/types";
import { initialsFor } from "../../src/web/layout";
import { Icon, Logo } from "./icons";

/**
 * Ported page chrome (Phase 6.1, issue #17) — a faithful JSX port of
 * layout.ts's `pageShell`/`centeredShell`/`sidebar`/`topbar`, not a
 * redesign. Class names and inline styles are copied verbatim so
 * styles.ts's STYLESHEET (rendered once in the root layout) applies
 * identically. The one deliberate behavior change: the sidebar's logout
 * link now points at `/api/auth/logout` (a Next.js Route Handler) instead
 * of the Express app's `/logout` page route — see HANDOFF for why.
 */

type NavKey = "tasks" | "stats";

function Sidebar({ active, username, role }: { active: NavKey; username: string; role: string }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <div>
          <div className="mark">DEVCON</div>
          <div className="tag">Cohort 5 Taskbot</div>
        </div>
      </div>
      <div className="nav-eyebrow">Oversight</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <a className={`nav-item${active === "tasks" ? " active" : ""}`} href="/">
          <Icon name="clipboard" />
          <span>Task oversight</span>
        </a>
        <a className={`nav-item${active === "stats" ? " active" : ""}`} href="/stats">
          <Icon name="chart" />
          <span>Stats</span>
        </a>
      </div>
      <div className="side-user">
        <div className="av">{initialsFor(username)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="un">@{username}</div>
          <div className="ur">{role}</div>
        </div>
        <a style={{ color: "var(--fg-on-dark-3)", display: "flex" }} href="/api/auth/logout" title="Log out">
          <Icon name="logout" size={18} />
        </a>
      </div>
    </aside>
  );
}

function Topbar({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="topbar">
      <h1 style={{ color: "#0F172A" }}>{title}</h1>
      <div className="actions">{actions}</div>
    </header>
  );
}

export interface DashboardShellProps {
  active: NavKey;
  title: string;
  actions?: ReactNode;
  caller: Caller;
  children: ReactNode;
}

export function DashboardShell({ active, title, actions, caller, children }: DashboardShellProps) {
  return (
    <div className="app">
      <Sidebar active={active} username={caller.username} role={caller.role} />
      <div className="main">
        <Topbar title={title} actions={actions} />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export function CenteredShell({ children }: { children: ReactNode }) {
  return (
    <div className="centered" style={{ background: "var(--bg)" }}>
      {children}
    </div>
  );
}
