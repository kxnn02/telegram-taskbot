import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { openDatabase } from "../db/schema.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import { TaskService } from "../service/taskService.js";
import { createDashboardServer } from "./dashboardServer.js";
import type { TelegramAuthData } from "./telegramAuth.js";

const BOT_TOKEN = "555555:dashboard-test-token";
const COHORT = "cohort-5";
const NOW = new Date("2026-08-31T02:00:00.000Z");

function makeRoster() {
  return new Roster([
    { username: "alice", role: "Intern", cohortId: COHORT },
    { username: "bob", role: "Intern", cohortId: COHORT },
    { username: "carla", role: "HigherUp", cohortId: COHORT },
    { username: "dave", role: "HigherUp", cohortId: COHORT },
  ]);
}

function sign(data: Omit<TelegramAuthData, "hash">): TelegramAuthData {
  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  const checkString = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  return { ...data, hash };
}

function telegramPayloadFor(username: string, id = 111) {
  return sign({
    id,
    first_name: "Test",
    username,
    auth_date: Math.floor(Date.now() / 1000),
  });
}

function makeApp() {
  const db = openDatabase(":memory:");
  const roster = makeRoster();
  const clock = new FixedClock(NOW);
  const service = new TaskService(db, roster, clock);
  const app = createDashboardServer({ botToken: BOT_TOKEN, roster, service, botUsername: "devcon_cohort5_taskbot" });
  return { app, service };
}

function sessionCookieFrom(res: request.Response): string {
  const cookie = res.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("Expected a Set-Cookie header on the response.");
  return cookie;
}

function loginAs(app: import("express").Express, username: string) {
  return request(app)
    .get("/auth/telegram/callback")
    .query(telegramPayloadFor(username) as unknown as Record<string, string>);
}

describe("GET /login", () => {
  it("renders a login page including the Telegram Login Widget script", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/login");
    expect(res.status).toBe(200);
    expect(res.text).toContain("telegram-widget.js");
    expect(res.text).toContain("devcon_cohort5_taskbot");
  });
});

describe("GET /auth/telegram/callback", () => {
  it("logs in a higher-up and sets a session cookie", async () => {
    const { app } = makeApp();
    const res = await loginAs(app, "carla");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^session=/);
  });

  it("rejects an intern even though the Telegram login itself is valid", async () => {
    const { app } = makeApp();
    const res = await loginAs(app, "alice");
    expect(res.status).toBe(403);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a Telegram account not on the roster at all", async () => {
    const { app } = makeApp();
    const res = await loginAs(app, "eve_stranger");
    expect(res.status).toBe(403);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a tampered payload", async () => {
    const { app } = makeApp();
    const payload = telegramPayloadFor("carla");
    const res = await request(app)
      .get("/auth/telegram/callback")
      .query({ ...payload, username: "carla_but_altered" } as unknown as Record<string, string>);
    expect(res.status).toBe(401);
  });
});

describe("GET / (oversight view)", () => {
  it("redirects to /login when no session cookie is present", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("shows the full task list to a logged-in higher-up", async () => {
    const { app, service } = makeApp();
    service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Write the onboarding doc", description: "d", dueDate: "2026-09-05" },
    );
    service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "bob", title: "Fix the login bug", description: "d", dueDate: "2026-08-01" },
    );

    const login = await loginAs(app, "carla");
    const cookie = sessionCookieFrom(login);

    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Write the onboarding doc");
    expect(res.text).toContain("Fix the login bug");
    expect(res.text).toContain("alice");
    expect(res.text).toContain("bob");
  });

  it("filters to the overdue-backlog status group via query param", async () => {
    const { app, service } = makeApp();
    service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Not overdue task", description: "d", dueDate: "2026-09-05" },
    );
    service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "bob", title: "Overdue task", description: "d", dueDate: "2026-08-01" },
    );

    const login = await loginAs(app, "carla");
    const cookie = sessionCookieFrom(login);

    const res = await request(app).get("/?status=overdue-backlog").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Overdue task");
    expect(res.text).not.toContain("Not overdue task");
  });

  it("filters to a single assignee via query param", async () => {
    const { app, service } = makeApp();
    service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Alice's task", description: "d", dueDate: "2026-09-05" },
    );
    service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "bob", title: "Bob's task", description: "d", dueDate: "2026-09-05" },
    );

    const login = await loginAs(app, "carla");
    const cookie = sessionCookieFrom(login);

    const res = await request(app).get("/?assignee=bob").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Bob&#39;s task");
    expect(res.text).not.toContain("Alice&#39;s task");
  });

  it("no longer grants access after /logout", async () => {
    const { app } = makeApp();
    const login = await loginAs(app, "carla");
    const cookie = sessionCookieFrom(login);

    await request(app).get("/logout").set("Cookie", cookie);
    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });
});

async function loginCookie(app: import("express").Express, username = "carla") {
  const login = await loginAs(app, username);
  return sessionCookieFrom(login);
}

describe("GET /tasks/new", () => {
  it("redirects to /login when not authenticated", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/tasks/new");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("shows a creation form listing the cohort's known interns as assignee options", async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app).get("/tasks/new").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("alice");
    expect(res.text).toContain("bob");
    expect(res.text).toMatch(/<form[^>]*method="post"[^>]*action="\/tasks\/new"/i);
  });
});

describe("POST /tasks/new", () => {
  it("parses the due date and shows a confirm step instead of saving immediately", async () => {
    const { app, service } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app)
      .post("/tasks/new")
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft the checklist",
        dueDateText: "Sept 5, 2026",
      });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Saturday, September 5, 2026");
    expect(res.text).toMatch(/<form[^>]*action="\/tasks\/new\/confirm"/i);

    // Not saved yet — confirm step required first.
    const all = service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
    expect(all.ok && all.value).toHaveLength(0);
  });

  it("re-renders the form with an error when the due date can't be parsed", async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app)
      .post("/tasks/new")
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft the checklist",
        dueDateText: "asdfasdf not a date",
      });
    expect(res.status).toBe(400);
    expect(res.text).toContain("couldn&#39;t understand that date");
    expect(res.text).toContain("Write the onboarding doc"); // preserved
  });
});

describe("POST /tasks/new/confirm", () => {
  it("creates the task via TaskService once confirmed, and redirects", async () => {
    const { app, service } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app)
      .post("/tasks/new/confirm")
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "alice",
        title: "Write the onboarding doc",
        description: "Draft the checklist",
        dueDate: "2026-09-05",
      });
    expect(res.status).toBe(302);

    const all = service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
    expect(all.ok && all.value).toHaveLength(1);
    expect(all.ok && all.value[0]?.assigneeUsername).toBe("alice");
    expect(all.ok && all.value[0]?.status).toBe("Assigned");
  });

  it("rejects assigning to someone who isn't a known intern, via the same TaskService rule the bot uses", async () => {
    const { app, service } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app)
      .post("/tasks/new/confirm")
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "carla", // a higher-up, not an intern
        title: "Bad assignment",
        description: "d",
        dueDate: "2026-09-05",
      });
    expect(res.status).toBe(400);
    expect(res.text).toContain("isn&#39;t a known intern");
    const all = service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
    expect(all.ok && all.value).toHaveLength(0);
  });
});

describe("GET /tasks/:id/edit", () => {
  it("shows a prefilled edit form for an editable task", async () => {
    const { app, service } = makeApp();
    const created = service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Write the onboarding doc", description: "d", dueDate: "2026-09-05" },
    );
    if (!created.ok) throw new Error("setup failed");
    const cookie = await loginCookie(app);

    const res = await request(app).get(`/tasks/${created.value.id}/edit`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Write the onboarding doc");
    expect(res.text).toMatch(/<form[^>]*action="\/tasks\/\d+\/edit"/i);
  });

  it("shows a locked message instead of a form once the task is Approved, without editing it", async () => {
    const { app, service } = makeApp();
    const caller = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    const created = service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    service.submitTask({ username: "alice", role: "Intern", cohortId: COHORT }, created.value.id);
    service.approveTask(caller, created.value.id);
    const cookie = await loginCookie(app);

    const res = await request(app).get(`/tasks/${created.value.id}/edit`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text.toLowerCase()).toContain("locked");
    expect(res.text).not.toMatch(/<form[^>]*action="\/tasks\/\d+\/edit"/i);
  });

  it("404s for a task id that doesn't exist", async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app).get("/tasks/999/edit").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

describe("POST /tasks/:id/edit and /tasks/:id/edit/confirm", () => {
  it("edits any task, not just ones the caller personally assigned", async () => {
    const { app, service } = makeApp();
    // Assigned by carla; dave (a different higher-up) will edit it.
    const created = service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Original title", description: "d", dueDate: "2026-09-05" },
    );
    if (!created.ok) throw new Error("setup failed");

    const cookie = await loginCookie(app, "dave");
    const confirmRes = await request(app)
      .post(`/tasks/${created.value.id}/edit`)
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "alice",
        title: "Updated title",
        description: "d2",
        dueDateText: "2026-09-10",
      });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.text).toMatch(/<form[^>]*action="\/tasks\/\d+\/edit\/confirm"/i);

    const applyRes = await request(app)
      .post(`/tasks/${created.value.id}/edit/confirm`)
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "alice",
        title: "Updated title",
        description: "d2",
        dueDate: "2026-09-10",
      });
    expect(applyRes.status).toBe(302);

    const all = service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
    expect(all.ok && all.value[0]?.title).toBe("Updated title");
    expect(all.ok && all.value[0]?.dueDate).toBe("2026-09-10");
  });

  it("refuses to save an edit once the task has become Approved (checked again at confirm time)", async () => {
    const { app, service } = makeApp();
    const caller = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    const created = service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    const cookie = await loginCookie(app);

    // Someone approves the task after the edit form was loaded but before confirm.
    service.submitTask({ username: "alice", role: "Intern", cohortId: COHORT }, created.value.id);
    service.approveTask(caller, created.value.id);

    const res = await request(app)
      .post(`/tasks/${created.value.id}/edit/confirm`)
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "alice",
        title: "Sneaky post-approval edit",
        description: "d",
        dueDate: "2026-09-06",
      });
    expect(res.status).toBe(400);
    expect(res.text).toContain("locked from further edits");

    const stored = service.getTask(caller, created.value.id);
    expect(stored.ok && stored.value.title).toBe("Write the onboarding doc");
  });
});

describe("GET /stats", () => {
  it("redirects to /login when not authenticated", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/stats");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("shows completed-per-intern, completion rate, average time-to-submit, and completed-this-week", async () => {
    const { app, service } = makeApp();
    const caller = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    const t1 = service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "Task one",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!t1.ok) throw new Error("setup failed");
    service.submitTask({ username: "alice", role: "Intern", cohortId: COHORT }, t1.value.id);
    service.approveTask(caller, t1.value.id);

    const cookie = await loginCookie(app);
    const res = await request(app).get("/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("alice");
    expect(res.text).toMatch(/completion rate/i);
    expect(res.text).toMatch(/average time.to.submit/i);
    expect(res.text).toMatch(/completed this week/i);
  });
});
