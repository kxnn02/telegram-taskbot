import { icon, LOGO, STYLESHEET } from "./styles.js";

/**
 * The shared page chrome (spec §3.3): every one of the 8 dashboard pages —
 * task oversight, stats, new/edit task forms, their confirm steps, login,
 * and the error/message page — renders through one of the two shells here
 * instead of eight hand-rolled `<html>` strings. `pageShell` is the
 * sidebar+topbar+content layout (the design's "Main"/"Stats"/forms
 * artboards); `centeredShell` is the sidebar-less centred card used by the
 * Login and Message artboards.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "@mika_reyes" -> "MR", "@kxnn02" -> "KX" — first letter of each
 * underscore-separated segment (up to two), or the first two characters of
 * the whole username when there's no underscore. Matches the design's
 * avatar initials. */
export function initialsFor(username: string): string {
  const parts = username.split("_").filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return username.slice(0, 2).toUpperCase();
}

type NavKey = "tasks" | "stats";

function sidebar(active: NavKey, username: string, role: string): string {
  return `
  <aside class="sidebar">
    <div class="brand">
      ${LOGO}
      <div>
        <div class="mark">DEVCON<span style="color:#4263EB">+</span></div>
        <div class="tag">Cohort 5 Taskbot</div>
      </div>
    </div>
    <div class="nav-eyebrow">Oversight</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <a class="nav-item${active === "tasks" ? " active" : ""}" href="/">${icon("clipboard")}<span>Task oversight</span></a>
      <a class="nav-item${active === "stats" ? " active" : ""}" href="/stats">${icon("chart")}<span>Stats</span></a>
    </div>
    <div class="side-user">
      <div class="av">${escapeHtml(initialsFor(username))}</div>
      <div style="flex:1;min-width:0">
        <div class="un">@${escapeHtml(username)}</div>
        <div class="ur">${escapeHtml(role)}</div>
      </div>
      <a style="color:var(--fg-on-dark-3);display:flex" href="/logout" title="Log out">${icon("logout", 18)}</a>
    </div>
  </aside>`;
}

function topbar(title: string, actions: string): string {
  return `
  <header class="topbar">
    <h1 style="color:#0F172A">${escapeHtml(title)}</h1>
    <div class="actions">${actions}</div>
  </header>`;
}

export interface PageShellOptions {
  active: NavKey;
  title: string;
  actions?: string;
  caller: { username: string; role: string };
  content: string;
}

export function pageShell(options: PageShellOptions): string {
  const body = `
<div class="app">
  ${sidebar(options.active, options.caller.username, options.caller.role)}
  <div class="main">
    ${topbar(options.title, options.actions ?? "")}
    <div class="content">${options.content}</div>
  </div>
</div>`;
  return shell(escapeHtml(options.title), body);
}

export function centeredShell(title: string, content: string): string {
  return shell(title, `<div class="centered" style="background:var(--bg)">${content}</div>`);
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&display=swap">
  <style>
${STYLESHEET}
  </style>
</head>
<body>
${body}
</body>
</html>`;
}
