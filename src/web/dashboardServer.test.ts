import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import { TaskService } from "../service/taskService.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { createDashboardServer } from "./dashboardServer.js";
import type { TelegramAuthData } from "./telegramAuth.js";

const BOT_TOKEN = "555555:dashboard-test-token";
const SESSION_SECRET = "dashboard-test-session-secret";
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
  const store = new InMemoryTaskStore();
  const roster = makeRoster();
  const clock = new FixedClock(NOW);
  const service = new TaskService(store, roster, clock);
  const app = createDashboardServer({
    botToken: BOT_TOKEN,
    roster,
    service,
    botUsername: "devcon_cohort5_taskbot",
    activeCohortId: COHORT,
    sessionSecret: SESSION_SECRET,
  });
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

  it("logs in against the dashboard's own bound cohort, not whichever cohort happens to be first in roster order, when the same username exists in more than one cohort (ADR-0004's dry-run reused accounts)", async () => {
    const store = new InMemoryTaskStore();
    const roster = new Roster([
      { username: "carla", role: "HigherUp", cohortId: "cohort-5" },
      { username: "carla", role: "HigherUp", cohortId: "cohort5-dryrun" },
      { username: "alice", role: "Intern", cohortId: "cohort5-dryrun" },
    ]);
    const service = new TaskService(store, roster, new FixedClock(NOW));
    await service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: "cohort5-dryrun" },
      { assigneeUsername: "alice", title: "dry-run-only task", description: "d", dueDate: "2026-09-05" },
    );

    const app = createDashboardServer({
      botToken: BOT_TOKEN,
      roster,
      service,
      botUsername: "devcon_cohort5_taskbot",
      activeCohortId: "cohort5-dryrun",
      sessionSecret: SESSION_SECRET,
    });

    const login = await request(app)
      .get("/auth/telegram/callback")
      .query(telegramPayloadFor("carla") as unknown as Record<string, string>);
    expect(login.status).toBe(302);
    const cookie = sessionCookieFrom(login);

    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("dry-run-only task");
  });
});

describe("GET / (oversight view)", () => {
  it("redirects to /login when no session cookie is present", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("redirects to /login when the session cookie is tampered with", async () => {
    const { app } = makeApp();
    const login = await loginAs(app, "carla");
    const cookie = sessionCookieFrom(login);
    const valuePart = cookie.split(";")[0] as string; // "session=<value>"
    const tamperedValue = valuePart.slice(0, -4) + "dead";
    const res = await request(app).get("/").set("Cookie", tamperedValue);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("redirects to /login when the session cookie is garbage", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/").set("Cookie", "session=not-a-real-session-value");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("shows the full task list to a logged-in higher-up", async () => {
    const { app, service } = makeApp();
    await service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Write the onboarding doc", description: "d", dueDate: "2026-09-05" },
    );
    await service.assignTask(
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
    await service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Not overdue task", description: "d", dueDate: "2026-09-05" },
    );
    await service.assignTask(
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
    await service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Alice's task", description: "d", dueDate: "2026-09-05" },
    );
    await service.assignTask(
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

  it("/logout clears the session cookie, so a normal browser loses access afterward", async () => {
    // Sessions are now a signed, stateless cookie (ADR-0008) — there's
    // nothing server-side left to revoke, so "logout" can only tell the
    // browser to drop the cookie (Set-Cookie with Max-Age=0). A real
    // browser honors that and stops sending the old value, which this
    // agent (a real cookie jar) models faithfully. Deliberately not
    // tested here: manually replaying the old signed cookie value after
    // logout still authenticates, since there's no server-side
    // revocation/blocklist — ADR-0008 explicitly defers that as a future
    // add, not needed at this dashboard's ~8-user scale.
    const { app } = makeApp();
    const agent = request.agent(app);
    await agent
      .get("/auth/telegram/callback")
      .query(telegramPayloadFor("carla") as unknown as Record<string, string>);

    await agent.get("/logout");
    const res = await agent.get("/");
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
    const all = await service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
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

    const all = await service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
    expect(all.ok && all.value).toHaveLength(1);
    expect(all.ok && all.value[0]?.assigneeUsername).toBe("alice");
    expect(all.ok && all.value[0]?.status).toBe("todo");
  });

  it("allows assigning to a higher-up — assignment is open to any roster member, not just interns", async () => {
    const { app, service } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app)
      .post("/tasks/new/confirm")
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "carla", // a higher-up
        title: "Assignable to anyone now",
        description: "d",
        dueDate: "2026-09-05",
      });
    expect(res.status).toBe(302);
    const all = await service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
    expect(all.ok && all.value.find((t) => t.assigneeUsername === "carla")).toBeDefined();
  });

  it("rejects assigning to someone off the roster entirely, via the same TaskService rule the bot uses", async () => {
    const { app, service } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app)
      .post("/tasks/new/confirm")
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "ghost",
        title: "Bad assignment",
        description: "d",
        dueDate: "2026-09-05",
      });
    expect(res.status).toBe(400);
    expect(res.text).toContain("isn&#39;t a known roster member");
    const all = await service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
    expect(all.ok && all.value).toHaveLength(0);
  });
});

describe("GET /tasks/:id/edit", () => {
  it("shows a prefilled edit form for an editable task", async () => {
    const { app, service } = makeApp();
    const created = await service.assignTask(
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

  it("still shows an editable form once the task is done — the Approved edit-lock is gone (issue #27/#28)", async () => {
    const { app, service } = makeApp();
    const caller = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    const created = await service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus({ username: "alice", role: "Intern", cohortId: COHORT }, created.value.id, "in_review");
    await service.setStatus(caller, created.value.id, "done");
    const cookie = await loginCookie(app);

    const res = await request(app).get(`/tasks/${created.value.id}/edit`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<form[^>]*action="\/tasks\/\d+\/edit"/i);
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
    const created = await service.assignTask(
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

    const all = await service.listAllTasks({ username: "carla", role: "HigherUp", cohortId: COHORT });
    expect(all.ok && all.value[0]?.title).toBe("Updated title");
    expect(all.ok && all.value[0]?.dueDate).toBe("2026-09-10");
  });

  it("still saves an edit after the task has become done — reopening/editing a done task is allowed (issue #27/#28)", async () => {
    const { app, service } = makeApp();
    const caller = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    const created = await service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "Write the onboarding doc",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    const cookie = await loginCookie(app);

    // The task is marked done after the edit form was loaded but before confirm.
    await service.setStatus({ username: "alice", role: "Intern", cohortId: COHORT }, created.value.id, "in_review");
    await service.setStatus(caller, created.value.id, "done");

    const res = await request(app)
      .post(`/tasks/${created.value.id}/edit/confirm`)
      .set("Cookie", cookie)
      .type("form")
      .send({
        assigneeUsername: "alice",
        title: "Edited after done",
        description: "d",
        dueDate: "2026-09-06",
      });
    expect(res.status).toBe(302);

    const stored = await service.getTask(caller, created.value.id);
    expect(stored.ok && stored.value.title).toBe("Edited after done");
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
    const t1 = await service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "Task one",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!t1.ok) throw new Error("setup failed");
    await service.setStatus({ username: "alice", role: "Intern", cohortId: COHORT }, t1.value.id, "in_review");
    await service.setStatus(caller, t1.value.id, "done");

    const cookie = await loginCookie(app);
    const res = await request(app).get("/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("alice");
    expect(res.text).toMatch(/completion rate/i);
    expect(res.text).toMatch(/average time.to.submit/i);
    expect(res.text).toMatch(/completed this week/i);
  });
});

describe("GET / — action grouping (default, group=action)", () => {
  it("renders the five action-group section headings in precedence order", async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const order = ["Needs your review", "Blocked", "Overdue", "Done", "Open"];
    const indices = order.map((label) => res.text.indexOf(label));
    for (const i of indices) expect(i).toBeGreaterThan(-1);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1] as number);
    }
  });

  it("puts a Submitted-and-overdue task under Needs your review, not Overdue", async () => {
    const { app, service } = makeApp();
    const caller = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    const created = await service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "Late but submitted task",
      description: "d",
      dueDate: "2026-08-01", // well before NOW, so overdue
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus({ username: "alice", role: "Intern", cohortId: COHORT }, created.value.id, "in_review");

    const cookie = await loginCookie(app);
    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const needsReviewIdx = res.text.indexOf("Needs your review");
    const blockedIdx = res.text.indexOf("Blocked");
    const taskIdx = res.text.indexOf("Late but submitted task");
    expect(taskIdx).toBeGreaterThan(needsReviewIdx);
    expect(taskIdx).toBeLessThan(blockedIdx);
    // Due date still renders red / late, even though it's grouped as review.
    expect(res.text).toContain("late");
  });

  it("renders Done collapsed — no table rows for its tasks", async () => {
    const { app, service } = makeApp();
    const caller = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    const created = await service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "A completed task title xyz",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus({ username: "alice", role: "Intern", cohortId: COHORT }, created.value.id, "in_review");
    await service.setStatus(caller, created.value.id, "done");

    const cookie = await loginCookie(app);
    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("A completed task title xyz");
  });

  it("gives every task an Edit action, including in the Done section context", async () => {
    const { app, service } = makeApp();
    const caller = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
    const created = await service.assignTask(caller, {
      assigneeUsername: "alice",
      title: "Open task without edit check",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    const cookie = await loginCookie(app);
    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(new RegExp(`/tasks/${created.value.id}/edit`));
  });

  it("falls back to action grouping for an unrecognised ?group= value instead of 400ing", async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app).get("/?group=bogus").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Needs your review");
  });

  it("keeps ?status= filtering working under the default action grouping", async () => {
    const { app, service } = makeApp();
    await service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Not overdue task", description: "d", dueDate: "2026-09-05" },
    );
    await service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "bob", title: "Overdue task", description: "d", dueDate: "2026-08-01" },
    );
    const cookie = await loginCookie(app);
    const res = await request(app).get("/?status=overdue-backlog").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Overdue task");
    expect(res.text).not.toContain("Not overdue task");
  });

  it("serves a real stylesheet with @font-face rules referencing the static font files", async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("@font-face");
    expect(res.text).toContain("/fonts/ProximaNova-Regular.woff2");
    expect(res.text).toContain("<style>");
  });
});

describe("GET /?group=intern", () => {
  it("renders per-intern headings and keeps the status chip row", async () => {
    const { app, service } = makeApp();
    await service.assignTask(
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assigneeUsername: "alice", title: "Alice's intern-mode task", description: "d", dueDate: "2026-09-05" },
    );
    const cookie = await loginCookie(app);
    const res = await request(app).get("/?group=intern").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("@alice");
    expect(res.text).toContain("Alice&#39;s intern-mode task");
  });

  it("does not render the action-group section headings", async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app);
    const res = await request(app).get("/?group=intern").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Needs your review");
  });
});

describe("GET /fonts/*.woff2", () => {
  it("serves the brand font files as static assets", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/fonts/ProximaNova-Regular.woff2");
    expect(res.status).toBe(200);
  });
});
