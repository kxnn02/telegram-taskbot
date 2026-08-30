import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import type { CohortStats, TaskService, TaskWithFlags } from "../service/taskService.js";
import { parseDueDate } from "../date/parseDueDate.js";
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
  app.use(express.urlencoded({ extended: false }));

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

  // ---- Task creation (issue #4) --------------------------------------
  // Mirrors the bot's /assign wizard: assignee/title/description/due-date
  // required, due date parsed from natural language and echoed back for
  // confirmation before saving — all via TaskService.assignTask, the same
  // method the bot calls. Multi-step form across two page loads instead of
  // a wizard, per this project's "bare HTML, no client-side JS" convention.

  app.get("/tasks/new", requireSession, (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    res.status(200).type("html").send(renderCreateForm(options.roster, caller));
  });

  app.post("/tasks/new", requireSession, (req, res) => {
    const body = req.body as Record<string, string | undefined>;
    const fields = {
      assigneeUsername: body.assigneeUsername ?? "",
      title: body.title ?? "",
      description: body.description ?? "",
      dueDateText: body.dueDateText ?? "",
    };
    const parsed = parseDueDate(fields.dueDateText);
    if (!parsed) {
      const caller = (req as Request & { caller: Caller }).caller;
      res
        .status(400)
        .type("html")
        .send(
          renderCreateForm(
            options.roster,
            caller,
            fields,
            `I couldn't understand that date. Try phrases like "next Friday", "in 3 days", or "Sept 5".`,
          ),
        );
      return;
    }
    res.status(200).type("html").send(renderCreateConfirm(fields, parsed));
  });

  app.post("/tasks/new/confirm", requireSession, (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const body = req.body as Record<string, string | undefined>;
    const result = options.service.assignTask(caller, {
      assigneeUsername: body.assigneeUsername ?? "",
      title: body.title ?? "",
      description: body.description ?? "",
      dueDate: body.dueDate ?? "",
    });
    if (!result.ok) {
      res.status(400).type("html").send(renderMessagePage("Couldn't create the task", result.error, "/tasks/new"));
      return;
    }
    res.redirect(302, "/");
  });

  // ---- Task editing (issue #4) ---------------------------------------
  // Mirrors the bot's /edit rule: any higher-up can edit any task (not just
  // ones they personally assigned), locked once Approved — both enforced by
  // TaskService.editTask itself, re-checked at confirm time in case the
  // task's status changed between the form load and the save (PRD §12,
  // last-write-wins concurrency).

  app.get("/tasks/:id/edit", requireSession, (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const id = Number(req.params.id);
    const found = options.service.getTask(caller, id);
    if (!found.ok) {
      res.status(404).type("html").send(renderMessagePage("Task not found", found.error, "/"));
      return;
    }
    if (found.value.status === "Approved") {
      res
        .status(200)
        .type("html")
        .send(
          renderMessagePage(
            "Task locked",
            `Task ${id} is Approved and locked from further edits, same as the bot's /edit rule.`,
            "/",
          ),
        );
      return;
    }
    res
      .status(200)
      .type("html")
      .send(
        renderEditForm(options.roster, found.value.cohortId, id, {
          assigneeUsername: found.value.assigneeUsername,
          title: found.value.title,
          description: found.value.description,
          dueDateText: found.value.dueDate,
        }),
      );
  });

  app.post("/tasks/:id/edit", requireSession, (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const id = Number(req.params.id);
    const body = req.body as Record<string, string | undefined>;
    const fields = {
      assigneeUsername: body.assigneeUsername ?? "",
      title: body.title ?? "",
      description: body.description ?? "",
      dueDateText: body.dueDateText ?? "",
    };
    const parsed = parseDueDate(fields.dueDateText);
    if (!parsed) {
      res
        .status(400)
        .type("html")
        .send(
          renderEditForm(
            options.roster,
            caller.cohortId,
            id,
            fields,
            `I couldn't understand that date. Try phrases like "next Friday", "in 3 days", or "Sept 5".`,
          ),
        );
      return;
    }
    res.status(200).type("html").send(renderEditConfirm(id, fields, parsed));
  });

  app.post("/tasks/:id/edit/confirm", requireSession, (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const id = Number(req.params.id);
    const body = req.body as Record<string, string | undefined>;
    const result = options.service.editTask(caller, id, {
      assigneeUsername: body.assigneeUsername ?? "",
      title: body.title ?? "",
      description: body.description ?? "",
      dueDate: body.dueDate ?? "",
    });
    if (!result.ok) {
      res.status(400).type("html").send(renderMessagePage("Couldn't save the edit", result.error, "/"));
      return;
    }
    res.redirect(302, "/");
  });

  // ---- Stats view (issue #4) ------------------------------------------

  app.get("/stats", requireSession, (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const result = options.service.getStats(caller);
    if (!result.ok) {
      res.status(500).type("html").send(renderMessagePage("Error", result.error, "/"));
      return;
    }
    res.status(200).type("html").send(renderStatsPage(caller, result.value));
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

function renderMessagePage(title: string, message: string, backHref = "/login"): string {
  const backLabel = backHref === "/login" ? "Back to login" : "Back to dashboard";
  return `<!doctype html>
<html>
<head><title>${escapeHtml(title)}</title></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p><a href="${backHref}">${backLabel}</a></p>
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
        <td>${t.status === "Approved" ? "" : `<a href="/tasks/${t.id}/edit">Edit</a>`}</td>
      </tr>`,
        )
        .join("\n");
      return `<h2>${escapeHtml(assignee)}</h2>
      <table border="1">
        <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Due</th><th>Overdue</th><th>Blocked</th><th></th></tr></thead>
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
  <p><a href="/tasks/new">+ New task</a> | <a href="/stats">Stats</a></p>
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

interface TaskFormFields {
  assigneeUsername: string;
  title: string;
  description: string;
  dueDateText: string;
}

function internOptions(roster: Roster, cohortId: string, selected: string): string {
  return roster
    .all()
    .filter((e) => e.role === "Intern" && e.cohortId === cohortId)
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(
      (e) =>
        `<option value="${escapeHtml(e.username)}"${e.username === selected ? " selected" : ""}>@${escapeHtml(e.username)}</option>`,
    )
    .join("\n");
}

function renderCreateForm(
  roster: Roster,
  caller: Caller,
  fields: TaskFormFields = { assigneeUsername: "", title: "", description: "", dueDateText: "" },
  error?: string,
): string {
  return `<!doctype html>
<html>
<head><title>New task — DevCon Cohort 5 Dashboard</title></head>
<body>
  <h1>New task</h1>
  ${error ? `<p><strong>${escapeHtml(error)}</strong></p>` : ""}
  <form method="post" action="/tasks/new">
    <p>
      <label>Assignee (must be a known intern):
        <select name="assigneeUsername" required>
          <option value="" disabled${fields.assigneeUsername ? "" : " selected"}>Choose an intern</option>
          ${internOptions(roster, caller.cohortId, fields.assigneeUsername)}
        </select>
      </label>
    </p>
    <p><label>Title: <input type="text" name="title" value="${escapeHtml(fields.title)}" required></label></p>
    <p><label>Description: <textarea name="description" required>${escapeHtml(fields.description)}</textarea></label></p>
    <p><label>Due date (e.g. "next Friday", "in 3 days", "Sept 5"): <input type="text" name="dueDateText" value="${escapeHtml(fields.dueDateText)}" required></label></p>
    <p><button type="submit">Continue</button></p>
  </form>
  <p><a href="/">Back to dashboard</a></p>
</body>
</html>`;
}

function renderCreateConfirm(
  fields: TaskFormFields,
  parsed: { isoDate: string; friendly: string },
): string {
  return `<!doctype html>
<html>
<head><title>Confirm due date — DevCon Cohort 5 Dashboard</title></head>
<body>
  <h1>Confirm due date</h1>
  <p>That's <strong>${escapeHtml(parsed.friendly)}</strong>. Save this task?</p>
  <ul>
    <li>Assignee: @${escapeHtml(fields.assigneeUsername)}</li>
    <li>Title: ${escapeHtml(fields.title)}</li>
    <li>Description: ${escapeHtml(fields.description)}</li>
  </ul>
  <form method="post" action="/tasks/new/confirm">
    <input type="hidden" name="assigneeUsername" value="${escapeHtml(fields.assigneeUsername)}">
    <input type="hidden" name="title" value="${escapeHtml(fields.title)}">
    <input type="hidden" name="description" value="${escapeHtml(fields.description)}">
    <input type="hidden" name="dueDate" value="${escapeHtml(parsed.isoDate)}">
    <button type="submit">Yes, create task</button>
  </form>
  <p><a href="/tasks/new">No, start over</a></p>
</body>
</html>`;
}

function renderEditForm(
  roster: Roster,
  cohortId: string,
  taskId: number,
  fields: TaskFormFields,
  error?: string,
): string {
  return `<!doctype html>
<html>
<head><title>Edit Task ${taskId} — DevCon Cohort 5 Dashboard</title></head>
<body>
  <h1>Edit Task ${taskId}</h1>
  ${error ? `<p><strong>${escapeHtml(error)}</strong></p>` : ""}
  <form method="post" action="/tasks/${taskId}/edit">
    <p>
      <label>Assignee (must be a known intern):
        <select name="assigneeUsername" required>
          ${internOptions(roster, cohortId, fields.assigneeUsername)}
        </select>
      </label>
    </p>
    <p><label>Title: <input type="text" name="title" value="${escapeHtml(fields.title)}" required></label></p>
    <p><label>Description: <textarea name="description" required>${escapeHtml(fields.description)}</textarea></label></p>
    <p><label>Due date (e.g. "next Friday", "in 3 days", "Sept 5"): <input type="text" name="dueDateText" value="${escapeHtml(fields.dueDateText)}" required></label></p>
    <p><button type="submit">Continue</button></p>
  </form>
  <p><a href="/">Back to dashboard</a></p>
</body>
</html>`;
}

function renderEditConfirm(
  taskId: number,
  fields: TaskFormFields,
  parsed: { isoDate: string; friendly: string },
): string {
  return `<!doctype html>
<html>
<head><title>Confirm due date — DevCon Cohort 5 Dashboard</title></head>
<body>
  <h1>Confirm due date</h1>
  <p>That's <strong>${escapeHtml(parsed.friendly)}</strong>. Save these changes to Task ${taskId}?</p>
  <ul>
    <li>Assignee: @${escapeHtml(fields.assigneeUsername)}</li>
    <li>Title: ${escapeHtml(fields.title)}</li>
    <li>Description: ${escapeHtml(fields.description)}</li>
  </ul>
  <form method="post" action="/tasks/${taskId}/edit/confirm">
    <input type="hidden" name="assigneeUsername" value="${escapeHtml(fields.assigneeUsername)}">
    <input type="hidden" name="title" value="${escapeHtml(fields.title)}">
    <input type="hidden" name="description" value="${escapeHtml(fields.description)}">
    <input type="hidden" name="dueDate" value="${escapeHtml(parsed.isoDate)}">
    <button type="submit">Yes, save changes</button>
  </form>
  <p><a href="/tasks/${taskId}/edit">No, start over</a></p>
</body>
</html>`;
}

function renderStatsPage(caller: Caller, stats: CohortStats): string {
  const rows = stats.completedPerIntern
    .map((s) => `<tr><td>@${escapeHtml(s.username)}</td><td>${s.completed}</td></tr>`)
    .join("\n");
  const completionRatePercent = (stats.completionRate * 100).toFixed(1);
  const avgTimeToSubmit =
    stats.averageTimeToSubmitHours === null
      ? "No submitted tasks yet"
      : `${stats.averageTimeToSubmitHours.toFixed(1)} hours`;

  return `<!doctype html>
<html>
<head><title>Stats — DevCon Cohort 5 Dashboard</title></head>
<body>
  <h1>DevCon Cohort 5 — Stats</h1>
  <p>Logged in as @${escapeHtml(caller.username)} (${escapeHtml(caller.role)}) — <a href="/logout">Log out</a></p>
  <p><a href="/">Back to dashboard</a></p>

  <h2>Tasks completed per intern</h2>
  <table border="1">
    <thead><tr><th>Intern</th><th>Completed</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="2">No interns in this cohort.</td></tr>`}</tbody>
  </table>

  <h2>Completion rate</h2>
  <p>${completionRatePercent}% (Approved tasks out of all non-cancelled tasks)</p>

  <h2>Average time-to-submit</h2>
  <p>${avgTimeToSubmit}</p>

  <h2>Completed this week</h2>
  <p>${stats.completedThisWeek}</p>
</body>
</html>`;
}
