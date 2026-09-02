import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { InMemoryRosterStore } from "../storage/inMemoryRosterStore.js";
import { Roster } from "../domain/roster.js";
import type { Caller, Task } from "../domain/types.js";
import { RosterService } from "./rosterService.js";

const COHORT = "cohort-5";
const OTHER_COHORT = "cohort-4";

function caller(username: string, role: "Intern" | "HigherUp", cohortId = COHORT): Caller {
  return { username, role, cohortId };
}

const carla = caller("carla", "HigherUp");
const dave = caller("dave", "HigherUp");
const alice = caller("alice", "Intern");
const bob = caller("bob", "Intern");

async function makeService(seed: { username: string; role: "Intern" | "HigherUp"; cohortId?: string }[]) {
  const rosterStore = new InMemoryRosterStore();
  for (const entry of seed) {
    await rosterStore.upsert(
      { username: entry.username, role: entry.role, cohortId: entry.cohortId ?? COHORT },
      entry.username,
    );
  }
  const roster = new Roster(await rosterStore.listAll());
  const taskStore = new InMemoryTaskStore();
  const service = new RosterService(rosterStore, roster, taskStore);
  return { service, rosterStore, roster, taskStore };
}

function baseSeed() {
  return [
    { username: "carla", role: "HigherUp" as const },
    { username: "dave", role: "HigherUp" as const },
    { username: "alice", role: "Intern" as const },
    { username: "bob", role: "Intern" as const },
  ];
}

async function insertTask(taskStore: InMemoryTaskStore, overrides: Partial<Task> = {}): Promise<Task> {
  const id = await taskStore.nextId(overrides.cohortId ?? COHORT);
  const now = new Date().toISOString();
  const task: Task = {
    id,
    cohortId: COHORT,
    title: "Some task",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05",
    status: "todo",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const inserted = await taskStore.insertTask(task);
  return inserted;
}

describe("listMembers", () => {
  it("lets a higher-up list the cohort's roster", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.listMembers(carla);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((e) => e.username).sort()).toEqual(["alice", "bob", "carla", "dave"]);
    }
  });

  it("refuses an intern", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.listMembers(alice);
    expect(result.ok).toBe(false);
  });

  it("scopes to the caller's cohort only", async () => {
    const { service } = await makeService([
      ...baseSeed(),
      { username: "erin", role: "HigherUp", cohortId: OTHER_COHORT },
    ]);
    const result = await service.listMembers(carla);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((e) => e.username === "erin")).toBe(false);
    }
  });
});

describe("addMember", () => {
  it("lets a higher-up add an intern by default", async () => {
    const { service, rosterStore } = await makeService(baseSeed());
    const result = await service.addMember(carla, "erin", "Intern", false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ username: "erin", role: "Intern", cohortId: COHORT });
    }
    expect(rosterStore.setByOf(COHORT, "erin")).toBe("carla");
  });

  it("refuses an intern adding another intern", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.addMember(alice, "erin", "Intern", false);
    expect(result.ok).toBe(false);
  });

  it("refuses adding as higherup without a verified group-admin check, even for a higher-up caller", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.addMember(carla, "erin", "HigherUp", false);
    expect(result.ok).toBe(false);
  });

  it("allows adding as higherup with a verified group-admin check, even for an intern caller", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.addMember(alice, "erin", "HigherUp", true);
    expect(result.ok).toBe(true);
  });

  it("refuses adding an existing member rather than silently overwriting", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.addMember(carla, "alice", "Intern", false);
    expect(result.ok).toBe(false);
  });

  it("records the acting caller, not the target, as role_set_by", async () => {
    const { service, rosterStore } = await makeService(baseSeed());
    await service.addMember(carla, "erin", "HigherUp", true);
    expect(rosterStore.setByOf(COHORT, "erin")).toBe("carla");
  });
});

describe("setRole", () => {
  it("refuses without a verified group-admin check, even for a higher-up caller", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.setRole(carla, "alice", "HigherUp", false);
    expect(result.ok).toBe(false);
  });

  it("allows with a verified group-admin check, even for an intern caller", async () => {
    const { service, rosterStore } = await makeService(baseSeed());
    const result = await service.setRole(alice, "bob", "HigherUp", true);
    expect(result.ok).toBe(true);
    expect(rosterStore.setByOf(COHORT, "bob")).toBe("alice");
  });

  it("refuses demoting the last higher-up", async () => {
    const { service } = await makeService([
      { username: "carla", role: "HigherUp" },
      { username: "alice", role: "Intern" },
    ]);
    const result = await service.setRole(alice, "carla", "Intern", true);
    expect(result.ok).toBe(false);
  });

  it("allows demoting a higher-up when another higher-up remains", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.setRole(carla, "dave", "Intern", true);
    expect(result.ok).toBe(true);
  });

  it("refuses a username that isn't a roster member of the caller's cohort", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.setRole(carla, "ghost", "Intern", true);
    expect(result.ok).toBe(false);
  });

  it("refuses across cohort boundaries", async () => {
    const { service } = await makeService([
      ...baseSeed(),
      { username: "erin", role: "HigherUp", cohortId: OTHER_COHORT },
    ]);
    const result = await service.setRole(carla, "erin", "Intern", true);
    expect(result.ok).toBe(false);
  });
});

describe("removeMember", () => {
  it("refuses without a verified group-admin check, even for a higher-up caller", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.removeMember(carla, "alice", false);
    expect(result.ok).toBe(false);
  });

  it("allows with a verified group-admin check, even for an intern caller", async () => {
    const { service, rosterStore } = await makeService(baseSeed());
    const result = await service.removeMember(alice, "bob", true);
    expect(result.ok).toBe(true);
    expect(await rosterStore.listAll()).not.toContainEqual(
      expect.objectContaining({ username: "bob" }),
    );
  });

  it("refuses removing the last higher-up", async () => {
    const { service } = await makeService([
      { username: "carla", role: "HigherUp" },
      { username: "alice", role: "Intern" },
    ]);
    const result = await service.removeMember(alice, "carla", true);
    expect(result.ok).toBe(false);
  });

  it("allows removing a higher-up when another higher-up remains", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.removeMember(carla, "dave", true);
    expect(result.ok).toBe(true);
  });

  it("refuses a username that isn't a roster member of the caller's cohort", async () => {
    const { service } = await makeService(baseSeed());
    const result = await service.removeMember(carla, "ghost", true);
    expect(result.ok).toBe(false);
  });

  it("refuses removal while the member holds open tasks, naming them in the message", async () => {
    const { service, taskStore } = await makeService(baseSeed());
    const t1 = await insertTask(taskStore, { assigneeUsername: "alice", status: "todo" });
    const t2 = await insertTask(taskStore, { assigneeUsername: "alice", status: "in_review" });
    const result = await service.removeMember(carla, "alice", true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(`${t1.id}`);
      expect(result.error).toContain(`${t2.id}`);
    }
  });

  it("allows removal when every one of the member's tasks is done", async () => {
    const { service, taskStore } = await makeService(baseSeed());
    await insertTask(taskStore, { assigneeUsername: "alice", status: "done" });
    const result = await service.removeMember(carla, "alice", true);
    expect(result.ok).toBe(true);
  });

  it("ignores another member's open tasks when checking this member's removal", async () => {
    const { service, taskStore } = await makeService(baseSeed());
    await insertTask(taskStore, { assigneeUsername: "bob", status: "todo" });
    const result = await service.removeMember(carla, "alice", true);
    expect(result.ok).toBe(true);
  });
});
