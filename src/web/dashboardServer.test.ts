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
