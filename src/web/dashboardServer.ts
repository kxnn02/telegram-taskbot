import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import type { TaskService, TaskWithFlags } from "../service/taskService.js";
import { verifyTelegramAuth, type TelegramAuthData } from "./telegramAuth.js";
import { SessionStore } from "./sessionStore.js";
import { parseCookies, serializeCookie } from "./cookies.js";
import { STATUS_GROUPS, filterByStatusGroup, groupByAssignee, type StatusGroup } from "./taskView.js";

export interface CreateDashboardServerOptions {
  botToken: string;
  /** Telegram bot username (without @), used by the Login Widget script. */
  botUsername: string;
  roster: Roster;
  service: TaskService;
  sessionStore?: SessionStore;
}

const SESSION_COOKIE = "session";

/**
 * The read-only oversight dashboard (issue #3): Telegram Login Widget auth
 * gated to HigherUp roster members, then a task list read entirely through
 * TaskService.listAllTasks — the same query the bot's /alltasks uses — with
 * presentation-only filtering/grouping on top (taskView.ts). No create/edit
 * routes here; that's issue #4.
 */
export function createDashboardServer(options: CreateDashboardServerOptions): Express {
  const sessionStore = options.sessionStore ?? new SessionStore();
  const app = express();

  function getCaller(req: Request): Caller | undefined {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (!token) return undefined;
    return sessionStore.get(token);
  }

  function requireSession(req: Request, res: Response, next: NextFunction) {
    const caller = getCaller(req);
    if (!caller) {
      res.redirect(302, "/login");
      return;
    }
    (req as Request & { caller: Caller }).caller = caller;
    next();
  }

  app.get("/login", (_req, res) => {
    res.status(200).type("html").send(renderLoginPage(options.botUsername));
  });

  app.get("/auth/telegram/callback", (req, res) => {
    const data = req.query as unknown as TelegramAuthData;
    const verified = verifyTelegramAuth(data, options.botToken);
    if (!verified.ok) {
      res.status(401).type("html").send(renderMessagePage("Login failed", verified.error));
      return;
    }

    const entry = options.roster.find(verified.username);
    if (!entry || entry.role !== "HigherUp") {
      res
        .status(403)
        .type("html")
        .send(
          renderMessagePage(
            "Not authorized",
            "This dashboard is for higher-ups only. Your Telegram account isn't registered as a higher-up for this cohort.",
          ),
        );
      return;
    }

    const caller: Caller = {
      username: entry.username,
      role: entry.role,
      cohortId: entry.cohortId,
    };
    const token = sessionStore.create(caller);
    res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, token));
    res.redirect(302, "/");
  });

  app.get("/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) sessionStore.destroy(token);
    res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0 }));
    res.redirect(302, "/login");
  });

  app.get("/", requireSession, (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const result = options.service.listAllTasks(caller);
    if (!result.ok) {
      res.status(500).type("html").send(renderMessagePage("Error", result.error));
      return;
    }

    const statusParam = req.query.status;
    const statusGroup =
      typeof statusParam === "string" && (STATUS_GROUPS as string[]).includes(statusParam)
        ? (statusParam as StatusGroup)
        : undefined;
    const assigneeParam = typeof req.query.assignee === "string" ? req.query.assignee : undefined;

    let tasks = filterByStatusGroup(result.value, statusGroup);
    if (assigneeParam) {
      tasks = tasks.filter((t) => t.assigneeUsername === assigneeParam);
    }

    res.status(200).type("html").send(renderDashboardPage(caller, tasks, result.value, statusGroup, assigneeParam));
  });

  return app;
}

function renderLoginPage(botUsername: string): string {
  return `<!doctype html>
<html>
<head><title>DevCon Cohort 5 Dashboard — Log in</title></head>
<body>
  <h1>DevCon Cohort 5 Dashboard</h1>
  <p>Log in with Telegram (higher-ups only):</p>
  <script async src="https://telegram.org/js/telegram-widget.js?22"
    data-telegram-login="${escapeHtml(botUsername)}"
    data-size="large"
    data-auth-url="/auth/telegram/callback"
    data-request-access="write"></script>
</body>
</html>`;
}

function renderMessagePage(title: string, message: string): string {
  return `<!doctype html>
<html>
<head><title>${escapeHtml(title)}</title></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p><a href="/login">Back to login</a></p>
</body>
</html>`;
}

function renderDashboardPage(
  caller: Caller,
  tasks: TaskWithFlags[],
  allTasks: TaskWithFlags[],
  activeStatus: StatusGroup | undefined,
  activeAssignee: string | undefined,
): string {
  const assignees = [...new Set(allTasks.map((t) => t.assigneeUsername))].sort();
  const grouped = groupByAssignee(tasks);

  const statusLinks = ["all", ...STATUS_GROUPS]
    .map((s) => {
      const href = s === "all" ? "/" : `/?status=${s}`;
      const active = s === (activeStatus ?? "all") ? " (active)" : "";
      return `<a href="${href}">${escapeHtml(s)}${active}</a>`;
    })
    .join(" | ");

  const assigneeLinks = ["all", ...assignees]
    .map((a) => {
      const href = a === "all" ? "/" : `/?assignee=${encodeURIComponent(a)}`;
      const active = a === (activeAssignee ?? "all") ? " (active)" : "";
      return `<a href="${href}">${escapeHtml(a)}${active}</a>`;
    })
    .join(" | ");

  const sections = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([assignee, assigneeTasks]) => {
      const rows = assigneeTasks
        .map(
          (t) => `<tr>
        <td>${t.id}</td>
        <td>${escapeHtml(t.title)}</td>
        <td>${escapeHtml(t.status)}</td>
        <td>${escapeHtml(t.dueDate)}</td>
        <td>${t.overdue ? `Overdue (${t.daysOverdue}d)` : ""}</td>
        <td>${t.blocked ? `Blocked: ${escapeHtml(t.blockedReason ?? "")}` : ""}</td>
      </tr>`,
        )
        .join("\n");
      return `<h2>${escapeHtml(assignee)}</h2>
      <table border="1">
        <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Due</th><th>Overdue</th><th>Blocked</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head><title>DevCon Cohort 5 Dashboard</title></head>
<body>
  <h1>DevCon Cohort 5 — Task Oversight</h1>
  <p>Logged in as @${escapeHtml(caller.username)} (${escapeHtml(caller.role)}) — <a href="/logout">Log out</a></p>
  <p>Filter by status: ${statusLinks}</p>
  <p>Filter by intern: ${assigneeLinks}</p>
  ${sections || "<p>No tasks match this filter.</p>"}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
