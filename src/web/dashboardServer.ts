import { fileURLToPath } from "node:url";
import path from "node:path";
import { DateTime } from "luxon";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import type { CohortStats, TaskService, TaskWithFlags } from "../service/taskService.js";
import { parseDueDate } from "../date/parseDueDate.js";
import { verifyTelegramAuth, type TelegramAuthData } from "./telegramAuth.js";
import { SessionStore } from "./sessionStore.js";
import { parseCookies, serializeCookie } from "./cookies.js";
import {
  STATUS_GROUPS,
  filterByStatusGroup,
  groupByAssignee,
  groupByAction,
  ACTION_GROUPS,
  type StatusGroup,
  type ActionGroup,
} from "./taskView.js";
import { escapeHtml, initialsFor, pageShell, centeredShell } from "./layout.js";
import { icon, LOGO } from "./styles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type GroupMode = "action" | "intern";
const GROUP_MODES: GroupMode[] = ["action", "intern"];

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
  app.use(express.static(path.join(__dirname, "public")));

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

  app.get("/", requireSession, async (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const result = await options.service.listAllTasks(caller);
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
    const groupParam = req.query.group;
    const groupMode: GroupMode =
      typeof groupParam === "string" && (GROUP_MODES as string[]).includes(groupParam)
        ? (groupParam as GroupMode)
        : "action";

    let tasks = filterByStatusGroup(result.value, statusGroup);
    if (assigneeParam) {
      tasks = tasks.filter((t) => t.assigneeUsername === assigneeParam);
    }

    res
      .status(200)
      .type("html")
      .send(renderDashboardPage(caller, tasks, result.value, statusGroup, assigneeParam, groupMode));
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
    const caller = (req as Request & { caller: Caller }).caller;
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
          renderCreateForm(
            options.roster,
            caller,
            fields,
            `I couldn't understand that date. Try phrases like "next Friday", "in 3 days", or "Sept 5".`,
          ),
        );
      return;
    }
    res.status(200).type("html").send(renderCreateConfirm(caller, fields, parsed));
  });

  app.post("/tasks/new/confirm", requireSession, async (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const body = req.body as Record<string, string | undefined>;
    const result = await options.service.assignTask(caller, {
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

  app.get("/tasks/:id/edit", requireSession, async (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const id = Number(req.params.id);
    const found = await options.service.getTask(caller, id);
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
        renderEditForm(options.roster, caller, found.value.cohortId, id, {
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
            caller,
            caller.cohortId,
            id,
            fields,
            `I couldn't understand that date. Try phrases like "next Friday", "in 3 days", or "Sept 5".`,
          ),
        );
      return;
    }
    res.status(200).type("html").send(renderEditConfirm(caller, id, fields, parsed));
  });

  app.post("/tasks/:id/edit/confirm", requireSession, async (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const id = Number(req.params.id);
    const body = req.body as Record<string, string | undefined>;
    const result = await options.service.editTask(caller, id, {
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

  app.get("/stats", requireSession, async (req, res) => {
    const caller = (req as Request & { caller: Caller }).caller;
    const result = await options.service.getStats(caller);
    if (!result.ok) {
      res.status(500).type("html").send(renderMessagePage("Error", result.error, "/"));
      return;
    }
    res.status(200).type("html").send(renderStatsPage(caller, result.value));
  });

  return app;
}

// ======================================================================
// Rendering — page chrome lives in layout.ts/styles.ts; everything below
// is content for the shared shells.
// ======================================================================

function renderLoginPage(botUsername: string): string {
  const telegramPlane = `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor">
<path d="M21.7 3.4 2.9 10.6c-.9.35-.9.86-.16 1.08l4.7 1.47 1.8 5.5c.22.6.4.83.83.83.42 0 .6-.19.83-.42l2.28-2.2 4.74 3.5c.87.48 1.5.23 1.72-.8l3.1-14.6c.32-1.27-.48-1.85-1.31-1.5Z"/></svg>`;
  const body = `
    <div class="card" style="text-align:center;padding:40px 36px">
      <div style="width:72px;height:72px;border-radius:20px;background:linear-gradient(185deg,#1E2A56,#0C1330);
        display:flex;align-items:center;justify-content:center;margin:0 auto 22px">${LOGO}</div>
      <div style="font:700 24px/32px var(--font-sans);letter-spacing:-0.02em;color:#0F172A">DEVCON Cohort 5</div>
      <div style="font:var(--md3-body-lg);color:#64748B;margin-top:6px">Task oversight dashboard</div>
      <div style="height:1px;background:#E2E8F0;margin:26px 0"></div>
      <div style="font:var(--md3-body-md);color:#64748B;margin-bottom:20px">
        Higher-ups only. Interns manage their tasks in Telegram.
      </div>
      <div style="display:flex;justify-content:center">
        <script async src="https://telegram.org/js/telegram-widget.js?22"
          data-telegram-login="${escapeHtml(botUsername)}"
          data-size="large"
          data-auth-url="/auth/telegram/callback"
          data-request-access="write"></script>
      </div>
      <div style="font:var(--md3-body-sm);color:#94A3B8;margin-top:18px">
        ${telegramPlane}
        Sync. Support. Succeed.
      </div>
    </div>`;
  return centeredShell("DevCon Cohort 5 Dashboard — Log in", body);
}

function renderMessagePage(title: string, message: string, backHref = "/login"): string {
  const backLabel = backHref === "/login" ? "Back to login" : "Back to dashboard";
  const body = `
    <div class="card" style="padding:36px">
      <div style="width:56px;height:56px;border-radius:50%;background:#FCE3E4;color:#C2363B;
        display:flex;align-items:center;justify-content:center;margin-bottom:20px">${icon("alert", 28)}</div>
      <div style="font:700 20px/28px var(--font-sans);color:#0F172A">${escapeHtml(title)}</div>
      <div style="font:var(--md3-body-lg);color:#64748B;margin-top:8px">${escapeHtml(message)}</div>
      <div style="display:flex;gap:10px;margin-top:26px">
        <a class="btn secondary" href="${backHref}">${icon("arrowLeft", 16)}<span>${escapeHtml(backLabel)}</span></a>
      </div>
    </div>`;
  return centeredShell(title, body);
}

// ---- Status badge vocabulary (design system) -------------------------

type BadgeKind = "tag" | "badge";
const STATUS_META: Record<
  TaskWithFlags["status"],
  { kind: BadgeKind; bg: string; fg: string; ic: Parameters<typeof icon>[0]; label: string }
> = {
  Assigned: { kind: "tag", bg: "", fg: "", ic: "hourglass", label: "Assigned" },
  InProgress: { kind: "badge", bg: "#E4EEFE", fg: "#1A5FCC", ic: "spark", label: "In progress" },
  Submitted: { kind: "badge", bg: "#FEF6D6", fg: "#9A6206", ic: "clock", label: "Submitted" },
  Approved: { kind: "badge", bg: "#DEF6EA", fg: "#0E7A4B", ic: "check", label: "Approved" },
  NeedsRevision: { kind: "badge", bg: "#FCE3E4", fg: "#C2363B", ic: "pen", label: "Needs revision" },
  Cancelled: { kind: "tag", bg: "", fg: "", ic: "alert", label: "Cancelled" },
};

function statusBadge(status: TaskWithFlags["status"]): string {
  const meta = STATUS_META[status];
  if (meta.kind === "tag") {
    return `<span class="tag">${icon(meta.ic, 12)}${meta.label}</span>`;
  }
  return `<span class="badge" style="background:${meta.bg};color:${meta.fg}">${icon(meta.ic, 13)}${meta.label}</span>`;
}

function dueLabel(dueDate: string): string {
  const dt = DateTime.fromISO(dueDate);
  return dt.isValid ? dt.toFormat("MMM d") : dueDate;
}

// ---- Task rows ---------------------------------------------------------

function editActionCell(t: TaskWithFlags): string {
  if (t.status === "Approved") return "";
  return `<a class="btn secondary sm" href="/tasks/${t.id}/edit">${icon("pen", 14)}<span>Edit</span></a>`;
}

/** Row for the action-grouped sections view: ID · Task · Intern · Status ·
 * Due · (actions). Overdue renders in the Due cell (red date + "Nd late"),
 * and a blocked reason renders as a `.sub` line under the title — there's
 * no separate Overdue/Blocked column any more (spec §3.2). */
function actionRow(t: TaskWithFlags): string {
  return `
        <tr>
          <td style="width:70px"><span class="id">#${t.id}</span></td>
          <td>
            <div class="ttl">${escapeHtml(t.title)}</div>
            ${t.blockedReason ? `<div class="sub">${escapeHtml(t.blockedReason)}</div>` : ""}
          </td>
          <td style="width:196px">
            <div class="cell-user">
              <div class="av sm">${escapeHtml(initialsFor(t.assigneeUsername))}</div>
              <div class="nm sm">@${escapeHtml(t.assigneeUsername)}</div>
            </div>
          </td>
          <td style="width:154px">${statusBadge(t.status)}</td>
          <td style="width:116px">
            <div style="font:600 14px/20px var(--font-sans);color:${t.overdue ? "#C2363B" : "#334155"}">${dueLabel(t.dueDate)}</div>
            ${t.overdue ? `<div style="font:var(--md3-body-sm);color:#C2363B;margin-top:3px">${t.daysOverdue}d late</div>` : ""}
          </td>
          <td style="width:100px">
            <div class="row-actions">${editActionCell(t)}</div>
          </td>
        </tr>`;
}

/** Row for the per-intern panels view (group=intern): same as actionRow but
 * without the redundant Intern column, since each panel is already scoped
 * to one intern. */
function internRow(t: TaskWithFlags): string {
  return `
        <tr>
          <td style="width:70px"><span class="id">#${t.id}</span></td>
          <td>
            <div class="ttl">${escapeHtml(t.title)}</div>
            ${t.blockedReason ? `<div class="sub">${escapeHtml(t.blockedReason)}</div>` : ""}
          </td>
          <td style="width:154px">${statusBadge(t.status)}</td>
          <td style="width:116px">
            <div style="font:600 14px/20px var(--font-sans);color:${t.overdue ? "#C2363B" : "#334155"}">${dueLabel(t.dueDate)}</div>
            ${t.overdue ? `<div style="font:var(--md3-body-sm);color:#C2363B;margin-top:3px">${t.daysOverdue}d late</div>` : ""}
          </td>
          <td style="width:100px">
            <div class="row-actions">${editActionCell(t)}</div>
          </td>
        </tr>`;
}

// ---- Action-grouped sections --------------------------------------------

interface ActionSectionMeta {
  label: string;
  ic: Parameters<typeof icon>[0];
  bg: string;
  fg: string;
  /** The existing StatusGroup this section's header links to via
   * `?status=`, per spec — the four sections that map to one get a link;
   * Open has none. */
  statusLink?: StatusGroup;
  collapsed?: boolean;
}

const ACTION_SECTION_META: Record<ActionGroup, ActionSectionMeta> = {
  "needs-review": { label: "Needs your review", ic: "clock", bg: "#FEF6D6", fg: "#9A6206", statusLink: "to-be-reviewed" },
  blocked: { label: "Blocked", ic: "lock", bg: "#E2E8F0", fg: "#1E2A56", statusLink: "blocked" },
  overdue: { label: "Overdue", ic: "alert", bg: "#FCE3E4", fg: "#C2363B", statusLink: "overdue-backlog" },
  done: { label: "Done", ic: "check", bg: "#DEF6EA", fg: "#0E7A4B", statusLink: "done", collapsed: true },
  open: { label: "Open", ic: "spark", bg: "#E4EEFE", fg: "#1A5FCC" },
};

function renderActionSection(meta: ActionSectionMeta, tasks: TaskWithFlags[]): string {
  const headingInner = `
          <div class="sec-ic" style="background:${meta.bg};color:${meta.fg}">${icon(meta.ic, 19)}</div>
          <h2 style="color:#0F172A">${escapeHtml(meta.label)}</h2>`;
  const heading = meta.statusLink
    ? `<a class="sec-head" style="color:inherit" href="/?status=${meta.statusLink}">${headingInner}</a>`
    : `<div class="sec-head">${headingInner}</div>`;
  return `
      <section class="panel">
        <div class="panel-head">
          ${heading}
          <div style="display:flex;align-items:center;gap:12px">
            <span class="count" style="background:${meta.bg};color:${meta.fg}">${tasks.length}</span>
            ${meta.collapsed ? icon("chevronDown", 18) : ""}
          </div>
        </div>
        ${
          meta.collapsed
            ? ""
            : `<table>
          <thead>
            <tr><th>ID</th><th>Task</th><th>Intern</th><th>Status</th><th>Due</th><th></th></tr>
          </thead>
          <tbody>${tasks.map(actionRow).join("")}</tbody>
        </table>`
        }
      </section>`;
}

// ---- Per-intern panels (group=intern) ------------------------------------

function renderInternPanels(tasks: TaskWithFlags[]): string {
  const grouped = groupByAssignee(tasks);
  const panels = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([assignee, assigneeTasks]) => `
      <section class="panel">
        <div class="panel-head">
          <div class="sec-head">
            <div class="cell-user"><div class="av">${escapeHtml(initialsFor(assignee))}</div><div class="nm">@${escapeHtml(assignee)}</div></div>
          </div>
          <span class="count" style="background:var(--slate-100);color:var(--fg2)">${assigneeTasks.length}</span>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>Task</th><th>Status</th><th>Due</th><th></th></tr>
          </thead>
          <tbody>${assigneeTasks.map(internRow).join("")}</tbody>
        </table>
      </section>`,
    )
    .join("");
  return panels || `<section class="panel" style="padding:24px"><p style="color:var(--fg3)">No tasks match this filter.</p></section>`;
}

// ---- Controls panel (group-by segmented control + intern chips) ---------

function renderControls(groupMode: GroupMode, assignees: string[], activeAssignee: string | undefined): string {
  const segLink = (mode: GroupMode, label: string) =>
    `<a class="${mode === groupMode ? "on" : ""}" href="/?group=${mode}">${escapeHtml(label)}</a>`;

  const internChip = (label: string, href: string, active: boolean) =>
    `<a class="chip${active ? " active" : ""}" href="${href}">${escapeHtml(label)}</a>`;

  const groupQuery = groupMode === "intern" ? "&group=intern" : "";
  const internChips = [
    internChip("All", groupMode === "intern" ? "/?group=intern" : "/", !activeAssignee),
    ...assignees.map((a) =>
      internChip(`@${a}`, `/?assignee=${encodeURIComponent(a)}${groupQuery}`, activeAssignee === a),
    ),
  ].join("");

  return `
      <section class="panel" style="padding:16px 20px;display:flex;flex-direction:column;gap:14px">
        <div class="chiprow">
          <span class="chip-label">Group by</span>
          <div class="seg">${segLink("action", "What it needs")}${segLink("intern", "Intern")}</div>
        </div>
        <div class="chiprow">
          <span class="chip-label">Intern</span>
          ${internChips}
        </div>
      </section>`;
}

/** The status filter chip row — only shown in `group=intern`; in action
 * mode, the sections themselves are the status affordance (spec §3.2). */
function renderStatusChips(activeStatus: StatusGroup | undefined): string {
  const chips = ["all", ...STATUS_GROUPS]
    .map((s) => {
      const href = s === "all" ? "/?group=intern" : `/?group=intern&status=${s}`;
      const active = s === (activeStatus ?? "all");
      return `<a class="chip${active ? " active" : ""}" href="${href}">${escapeHtml(s)}</a>`;
    })
    .join("");
  return `
      <section class="panel" style="padding:16px 20px">
        <div class="chiprow">
          <span class="chip-label">Status</span>
          ${chips}
        </div>
      </section>`;
}

function renderDashboardPage(
  caller: Caller,
  tasks: TaskWithFlags[],
  allTasks: TaskWithFlags[],
  activeStatus: StatusGroup | undefined,
  activeAssignee: string | undefined,
  groupMode: GroupMode,
): string {
  const assignees = [...new Set(allTasks.map((t) => t.assigneeUsername))].sort();

  const controls =
    renderControls(groupMode, assignees, activeAssignee) + (groupMode === "intern" ? renderStatusChips(activeStatus) : "");

  const sections =
    groupMode === "action"
      ? (() => {
          const grouped = groupByAction(tasks);
          return ACTION_GROUPS.map((g) => renderActionSection(ACTION_SECTION_META[g], grouped.get(g) ?? [])).join("");
        })()
      : renderInternPanels(tasks);

  const newTaskBtn = `<a class="btn primary" href="/tasks/new">${icon("plus", 17)}<span>New task</span></a>`;

  return pageShell({
    active: "tasks",
    title: "Task oversight",
    actions: newTaskBtn,
    caller,
    content: controls + sections,
  });
}

// ---- Create/edit forms ---------------------------------------------------

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

function taskFormBody(opts: {
  heading: string;
  chipText?: string;
  formAction: string;
  fields: TaskFormFields;
  internOptionsHtml: string;
  submitLabel: string;
  error?: string;
}): string {
  return `
      <section class="panel" style="max-width:820px">
        <div class="panel-head">
          <h2 style="color:#0F172A">${escapeHtml(opts.heading)}</h2>
          ${opts.chipText ? `<span class="id" style="font-size:14px">${escapeHtml(opts.chipText)}</span>` : ""}
        </div>
        <form method="post" action="${opts.formAction}" style="padding:24px 20px;display:flex;flex-direction:column;gap:20px">
          ${opts.error ? `<div style="font:var(--md3-body-md);color:#C2363B">${escapeHtml(opts.error)}</div>` : ""}
          <div class="field">
            <label for="assigneeUsername">Assignee</label>
            <div class="input">
              <select id="assigneeUsername" name="assigneeUsername" required>
                <option value="" disabled${opts.fields.assigneeUsername ? "" : " selected"}>Choose an intern</option>
                ${opts.internOptionsHtml}
              </select>
            </div>
          </div>
          <div class="field">
            <label for="title">Title</label>
            <div class="input">
              <input id="title" type="text" name="title" placeholder="Short, specific title" value="${escapeHtml(opts.fields.title)}" required>
            </div>
          </div>
          <div class="field">
            <label for="description">Description</label>
            <div class="input area">
              <textarea id="description" name="description" placeholder="What does done look like?" required>${escapeHtml(opts.fields.description)}</textarea>
            </div>
          </div>
          <div class="field">
            <label for="dueDateText">Due date</label>
            <div class="hint">Plain English works &mdash; &ldquo;next Friday&rdquo;, &ldquo;in 3 days&rdquo;, &ldquo;Sept 5&rdquo;.</div>
            <div class="input">
              <input id="dueDateText" type="text" name="dueDateText" placeholder="next Friday" value="${escapeHtml(opts.fields.dueDateText)}" required>
              <span style="color:#94A3B8;display:flex">${icon("calendar", 18)}</span>
            </div>
          </div>
          <div style="display:flex;gap:12px;align-items:center;padding-top:4px">
            <button type="submit" class="btn primary" style="background:#4263EB;color:#fff;border:0;cursor:pointer">${escapeHtml(opts.submitLabel)}</button>
            <a class="btn ghost" href="/">Back to dashboard</a>
          </div>
        </form>
      </section>`;
}

function renderCreateForm(
  roster: Roster,
  caller: Caller,
  fields: TaskFormFields = { assigneeUsername: "", title: "", description: "", dueDateText: "" },
  error?: string,
): string {
  const body = taskFormBody({
    heading: "New task",
    formAction: "/tasks/new",
    fields,
    internOptionsHtml: internOptions(roster, caller.cohortId, fields.assigneeUsername),
    submitLabel: "Continue",
    error,
  });
  return pageShell({ active: "tasks", title: "New task", caller, content: body });
}

function renderEditForm(
  roster: Roster,
  caller: Caller,
  cohortId: string,
  taskId: number,
  fields: TaskFormFields,
  error?: string,
): string {
  const body = taskFormBody({
    heading: "Edit task",
    chipText: `#${taskId}`,
    formAction: `/tasks/${taskId}/edit`,
    fields,
    internOptionsHtml: internOptions(roster, cohortId, fields.assigneeUsername),
    submitLabel: "Continue",
    error,
  });
  return pageShell({ active: "tasks", title: "Edit task", caller, content: body });
}

// ---- Confirm steps ---------------------------------------------------

function summaryRow(k: string, v: string): string {
  return `
            <div style="display:flex;gap:16px;padding:12px 0;border-bottom:1px solid #E2E8F0">
              <div style="width:120px;flex:none;font:var(--md3-label-lg);color:#94A3B8">${escapeHtml(k)}</div>
              <div style="font:var(--md3-body-lg);color:#0F172A">${v}</div>
            </div>`;
}

function confirmBody(opts: {
  heading: string;
  friendly: string;
  question: string;
  rows: string;
  formAction: string;
  hidden: Record<string, string>;
  submitLabel: string;
  backHref: string;
  backLabel: string;
}): string {
  const hiddenInputs = Object.entries(opts.hidden)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n");
  return `
      <section class="panel" style="max-width:720px">
        <div class="panel-head"><h2 style="color:#0F172A">${escapeHtml(opts.heading)}</h2></div>
        <div style="padding:24px 20px;display:flex;flex-direction:column;gap:4px">
          <div style="display:flex;gap:14px;align-items:center;background:#E4EEFE;border-radius:14px;padding:16px 18px">
            <span style="color:#1A5FCC;display:flex">${icon("calendar", 22)}</span>
            <div>
              <div style="font:700 17px/24px var(--font-sans);color:#1A5FCC">That's ${escapeHtml(opts.friendly)}.</div>
              <div style="font:var(--md3-body-md);color:#1A5FCC;opacity:.8">${escapeHtml(opts.question)}</div>
            </div>
          </div>
          <div style="padding-top:8px">${opts.rows}</div>
          <form method="post" action="${opts.formAction}" style="display:flex;gap:12px;align-items:center;padding-top:20px">
            ${hiddenInputs}
            <button type="submit" class="btn primary" style="background:#4263EB;color:#fff;border:0;cursor:pointer">${escapeHtml(opts.submitLabel)}</button>
            <a class="btn secondary" href="${opts.backHref}">${escapeHtml(opts.backLabel)}</a>
          </form>
        </div>
      </section>`;
}

function renderCreateConfirm(caller: Caller, fields: TaskFormFields, parsed: { isoDate: string; friendly: string }): string {
  const rows =
    summaryRow("Assignee", `@${escapeHtml(fields.assigneeUsername)}`) +
    summaryRow("Title", escapeHtml(fields.title)) +
    summaryRow("Description", escapeHtml(fields.description));
  const body = confirmBody({
    heading: "Confirm due date",
    friendly: parsed.friendly,
    question: "Save this task?",
    rows,
    formAction: "/tasks/new/confirm",
    hidden: {
      assigneeUsername: fields.assigneeUsername,
      title: fields.title,
      description: fields.description,
      dueDate: parsed.isoDate,
    },
    submitLabel: "Yes, create task",
    backHref: "/tasks/new",
    backLabel: "No, start over",
  });
  return pageShell({ active: "tasks", title: "New task", caller, content: body });
}

function renderEditConfirm(
  caller: Caller,
  taskId: number,
  fields: TaskFormFields,
  parsed: { isoDate: string; friendly: string },
): string {
  const rows =
    summaryRow("Assignee", `@${escapeHtml(fields.assigneeUsername)}`) +
    summaryRow("Title", escapeHtml(fields.title)) +
    summaryRow("Description", escapeHtml(fields.description));
  const body = confirmBody({
    heading: "Confirm due date",
    friendly: parsed.friendly,
    question: `Save these changes to Task ${taskId}?`,
    rows,
    formAction: `/tasks/${taskId}/edit/confirm`,
    hidden: {
      assigneeUsername: fields.assigneeUsername,
      title: fields.title,
      description: fields.description,
      dueDate: parsed.isoDate,
    },
    submitLabel: "Yes, save changes",
    backHref: `/tasks/${taskId}/edit`,
    backLabel: "No, start over",
  });
  return pageShell({ active: "tasks", title: "Edit task", caller, content: body });
}

// ---- Stats page --------------------------------------------------------

function statCard(label: string, value: string, ic: Parameters<typeof icon>[0], bg: string, fg: string): string {
  return `
        <div class="stat">
          <div class="ic" style="background:${bg};color:${fg}">${icon(ic, 20)}</div>
          <div class="v" style="color:#0F172A">${escapeHtml(value)}</div>
          <div class="k">${escapeHtml(label)}</div>
        </div>`;
}

function renderStatsPage(caller: Caller, stats: CohortStats): string {
  const completionRatePercent = (stats.completionRate * 100).toFixed(1);
  const avgTimeToSubmit =
    stats.averageTimeToSubmitHours === null
      ? "No submitted tasks yet"
      : `${stats.averageTimeToSubmitHours.toFixed(1)} hours`;
  const maxCompleted = Math.max(1, ...stats.completedPerIntern.map((s) => s.completed));

  const internRows = stats.completedPerIntern
    .map(
      (s) => `
        <tr>
          <td>
            <div class="cell-user"><div class="av">${escapeHtml(initialsFor(s.username))}</div><div class="nm">@${escapeHtml(s.username)}</div></div>
          </td>
          <td style="width:300px">
            <div class="bar"><div class="fill" style="width:${((s.completed / maxCompleted) * 100).toFixed(0)}%;background:#4263EB"></div></div>
          </td>
          <td style="width:110px;text-align:right">
            <span style="font:600 15px/22px var(--font-sans);color:#0F172A">${s.completed}</span>
          </td>
        </tr>`,
    )
    .join("");

  const body = `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">
        ${statCard("Completion rate", `${completionRatePercent}%`, "check", "#DEF6EA", "#0E7A4B")}
        ${statCard("Completed this week", String(stats.completedThisWeek), "spark", "#E4EEFE", "#1A5FCC")}
        ${statCard("Average time to submit", avgTimeToSubmit, "hourglass", "#FEF6D6", "#946008")}
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2 style="color:#0F172A">Tasks completed per intern</h2>
        </div>
        <table>
          <tbody>${internRows || `<tr><td style="padding:14px 20px">No interns in this cohort.</td></tr>`}</tbody>
        </table>
      </section>`;

  return pageShell({ active: "stats", title: "Stats", caller, content: body });
}
