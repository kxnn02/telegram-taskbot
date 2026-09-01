import { describe, expect, it } from "vitest";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import { TaskService } from "../service/taskService.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { loadOversightView } from "./oversightData.js";

/**
 * Data-fetching + authorization for the Next.js oversight page (Phase 6.1 /
 * issue #17's read-only oversight view). Pure function, independent of any
 * React/Next types, so the RSC (`app/page.tsx`) stays a thin wrapper around
 * it — mirrors the removed Express dashboard's `GET /` handler's query-parsing +
 * filtering, minus the res/req plumbing. Authorization itself is not
 * reimplemented here: it's delegated entirely to
 * `TaskService.listAllTasks`, which already enforces "HigherUp sees
 * everyone's tasks, Intern sees only their own" (see taskService.test.ts) —
 * this module must not invent a parallel rule.
 */

const COHORT = "cohort-5";
const NOW = new Date("2026-08-31T02:00:00.000Z");

async function makeService() {
  const store = new InMemoryTaskStore();
  const roster = new Roster([
    { username: "alice", role: "Intern", cohortId: COHORT },
    { username: "bob", role: "Intern", cohortId: COHORT },
    { username: "carla", role: "HigherUp", cohortId: COHORT },
  ]);
  const service = new TaskService(store, roster, new FixedClock(NOW));
  const higherUp = { username: "carla", role: "HigherUp" as const, cohortId: COHORT };
  await service.assignTask(higherUp, {
    assigneeUsername: "alice",
    title: "Alice task",
    description: "d",
    dueDate: "2026-09-05",
  });
  await service.assignTask(higherUp, {
    assigneeUsername: "bob",
    title: "Bob task",
    description: "d",
    dueDate: "2026-09-06",
  });
  return service;
}

describe("loadOversightView", () => {
  it("gives a HigherUp caller every task in the cohort", async () => {
    const service = await makeService();
    const result = await loadOversightView(service, { username: "carla", role: "HigherUp", cohortId: COHORT }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.allTasks.map((t) => t.title).sort()).toEqual(["Alice task", "Bob task"]);
    expect(result.value.tasks.map((t) => t.title).sort()).toEqual(["Alice task", "Bob task"]);
  });

  it("gives an Intern caller the same cohort-wide list (listAllTasks is team-wide transparency, per PRD §5 — not reimplemented or narrowed here)", async () => {
    const service = await makeService();
    const result = await loadOversightView(service, { username: "alice", role: "Intern", cohortId: COHORT }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.allTasks.map((t) => t.title).sort()).toEqual(["Alice task", "Bob task"]);
  });

  it("defaults to action-grouping mode when no ?group= query param is given", async () => {
    const service = await makeService();
    const result = await loadOversightView(service, { username: "carla", role: "HigherUp", cohortId: COHORT }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.groupMode).toBe("action");
  });

  it("honors ?group=intern", async () => {
    const service = await makeService();
    const result = await loadOversightView(
      service,
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { group: "intern" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.groupMode).toBe("intern");
  });

  it("ignores an invalid ?group= value and falls back to action mode", async () => {
    const service = await makeService();
    const result = await loadOversightView(
      service,
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { group: "nonsense" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.groupMode).toBe("action");
  });

  it("filters by ?status= (a known StatusGroup)", async () => {
    const service = await makeService();
    const result = await loadOversightView(
      service,
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { status: "to-be-reviewed" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.tasks).toEqual([]); // nothing Submitted yet
    expect(result.value.statusGroup).toBe("to-be-reviewed");
    // allTasks stays unfiltered — used to build the assignee chip list.
    expect(result.value.allTasks.length).toBe(2);
  });

  it("ignores an unknown ?status= value", async () => {
    const service = await makeService();
    const result = await loadOversightView(
      service,
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { status: "not-a-real-group" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.statusGroup).toBeUndefined();
    expect(result.value.tasks.length).toBe(2);
  });

  it("filters by ?assignee=", async () => {
    const service = await makeService();
    const result = await loadOversightView(
      service,
      { username: "carla", role: "HigherUp", cohortId: COHORT },
      { assignee: "bob" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.tasks.map((t) => t.title)).toEqual(["Bob task"]);
    expect(result.value.assignee).toBe("bob");
  });

  it("passes through a service-layer error", async () => {
    const service = {
      listAllTasks: async () => ({ ok: false as const, error: "boom" }),
    } as unknown as TaskService;
    const result = await loadOversightView(service, { username: "carla", role: "HigherUp", cohortId: COHORT }, {});
    expect(result).toEqual({ ok: false, error: "boom" });
  });
});
