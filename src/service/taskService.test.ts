import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "./taskService.js";

const COHORT = "cohort-5";
const OTHER_COHORT = "cohort-4";

function makeRoster() {
  return new Roster([
    { username: "alice", role: "Intern", cohortId: COHORT },
    { username: "bob", role: "Intern", cohortId: COHORT },
    { username: "carla", role: "HigherUp", cohortId: COHORT },
    { username: "dave", role: "HigherUp", cohortId: COHORT },
    { username: "erin", role: "Intern", cohortId: OTHER_COHORT },
    { username: "frank", role: "HigherUp", cohortId: OTHER_COHORT },
  ]);
}

function caller(username: string, role: "Intern" | "HigherUp", cohortId = COHORT): Caller {
  return { username, role, cohortId };
}

const NOW = new Date("2026-08-31T02:00:00.000Z"); // 2026-08-31 10:00 Asia/Manila

function makeService(now: Date = NOW) {
  const store = new InMemoryTaskStore();
  const roster = makeRoster();
  const clock = new FixedClock(now);
  return { service: new TaskService(store, roster, clock), store };
}

const carla = caller("carla", "HigherUp");
const dave = caller("dave", "HigherUp");
const alice = caller("alice", "Intern");
const bob = caller("bob", "Intern");

function assign(service: TaskService, overrides: Partial<{
  assigneeUsername: string;
  title: string;
  description: string;
  dueDate: string;
}> = {}) {
  return service.assignTask(carla, {
    assigneeUsername: "alice",
    title: "Write the onboarding doc",
    description: "Draft the intern onboarding checklist",
    dueDate: "2026-09-05",
    ...overrides,
  });
}

describe("assignTask", () => {
  it("lets a higher-up assign a task to an intern", async () => {
    const { service } = makeService();
    const result = await assign(service);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(1);
      expect(result.value.status).toBe("todo");
      expect(result.value.assigneeUsername).toBe("alice");
      expect(result.value.assignedByUsername).toBe("carla");
      expect(result.value.previousStatus).toBeNull();
    }
  });

  it("lets an intern assign a task too — task creation is open to any roster member", async () => {
    const { service } = makeService();
    const result = await service.assignTask(alice, {
      assigneeUsername: "bob",
      title: "help bob",
      description: "d",
      dueDate: "2026-09-05",
    });
    expect(result.ok).toBe(true);
  });

  it("lets a task be assigned to a higher-up — assignable is no longer intern-only", async () => {
    const { service } = makeService();
    const result = await assign(service, { assigneeUsername: "dave" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assigneeUsername).toBe("dave");
  });

  it("rejects assigning to someone not on the roster", async () => {
    const { service } = makeService();
    const result = await assign(service, { assigneeUsername: "ghost" });
    expect(result.ok).toBe(false);
  });

  it("rejects assigning across cohorts, even to a real roster member of another cohort", async () => {
    const { service } = makeService();
    const result = await assign(service, { assigneeUsername: "erin" }); // erin is cohort-4
    expect(result.ok).toBe(false);
  });

  it("allows an empty/omitted description — description is optional", async () => {
    const { service } = makeService();
    const result = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "one-liner task",
      dueDate: "2026-09-05",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBeUndefined();
  });

  it("rejects an empty title", async () => {
    const { service } = makeService();
    expect((await assign(service, { title: "  " })).ok).toBe(false);
  });

  it("rejects an invalid due date", async () => {
    const { service } = makeService();
    expect((await assign(service, { dueDate: "not-a-date" })).ok).toBe(false);
  });

  it("allocates sequential ids scoped per cohort", async () => {
    const { service } = makeService();
    const first = await assign(service);
    const second = await assign(service, { assigneeUsername: "bob" });
    expect(first.ok && first.value.id).toBe(1);
    expect(second.ok && second.value.id).toBe(2);
  });
});

describe("setStatus — the free-set status model", () => {
  it("an intern can set their own task to done without a higher-up — this is intended behaviour, not a permission bug", async () => {
    const { service } = makeService();
    const created = await assign(service); // assigned to alice
    if (!created.ok) throw new Error("setup failed");
    const result = await service.setStatus(alice, created.value.id, "done");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("done");
  });

  it("any roster member can set any status on a task that isn't theirs", async () => {
    const { service } = makeService();
    const created = await assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    const result = await service.setStatus(bob, created.value.id, "in_progress");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("in_progress");
  });

  it("a caller still cannot touch a task in another cohort", async () => {
    const { service } = makeService();
    const created = await assign(service); // cohort-5
    if (!created.ok) throw new Error("setup failed");
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    const result = await service.setStatus(otherCaller, created.value.id, "done");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't exist/i);
  });

  it("rejects a nonexistent task id", async () => {
    const { service } = makeService();
    const result = await service.setStatus(alice, 999, "done");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't exist/i);
  });

  it("moves freely through every status with no legality checks", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    for (const status of ["done", "backlog", "in_review", "todo", "in_progress"] as const) {
      const result = await service.setStatus(alice, id, status);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe(status);
    }
  });
});

describe("getTask", () => {
  it("performs no write — an intern viewing their own todo task leaves it todo, and row_version is unchanged", async () => {
    const { service, store } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    const before = await store.findTaskById(COHORT, id);
    const result = await service.getTask(alice, id);
    const after = await store.findTaskById(COHORT, id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("todo");
    expect(after?.rowVersion).toBe(before?.rowVersion);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("an intern can read a task assigned to a different intern in the same cohort", async () => {
    const { service } = makeService();
    const created = await assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    const result = await service.getTask(bob, created.value.id);
    expect(result.ok).toBe(true);
  });

  it("any higher-up can view any task's detail", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.getTask(dave, created.value.id);
    expect(result.ok).toBe(true);
  });

  it("returns a specific not-found message for a nonexistent id", async () => {
    const { service } = makeService();
    const result = await service.getTask(carla, 42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Task 42 doesn't exist.");
  });

  it("still refuses to leak a task from another cohort", async () => {
    const { service } = makeService();
    const created = await assign(service); // cohort-5
    if (!created.ok) throw new Error("setup failed");
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    const result = await service.getTask(otherCaller, created.value.id);
    expect(result.ok).toBe(false);
  });
});

describe("editTask", () => {
  it("lets any roster member edit a task, no role check", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.editTask(alice, created.value.id, { title: "New title" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe("New title");
  });

  it("done tasks remain editable — the Approved edit-lock is gone", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.setStatus(alice, id, "done");
    const result = await service.editTask(carla, id, { title: "reopened and edited" });
    expect(result.ok).toBe(true);
  });

  it("rejects reassigning to someone off the roster", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.editTask(carla, created.value.id, { assigneeUsername: "ghost" });
    expect(result.ok).toBe(false);
  });

  it("allows reassigning to a higher-up", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.editTask(carla, created.value.id, { assigneeUsername: "dave" });
    expect(result.ok).toBe(true);
  });
});

describe("addNote", () => {
  it("appends a note and it shows up on the task, from any roster member", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.addNote(alice, created.value.id, "Nice progress so far");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notes).toHaveLength(1);
      expect(result.value.notes[0]?.text).toBe("Nice progress so far");
      expect(result.value.notes[0]?.authorUsername).toBe("alice");
    }
  });

  it("rejects empty note text", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.addNote(carla, created.value.id, "   ");
    expect(result.ok).toBe(false);
  });
});

describe("blocked status", () => {
  it("an intern can block a task that isn't theirs", async () => {
    const { service } = makeService();
    const created = await assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    const result = await service.setBlocked(bob, created.value.id, "waiting on API access");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("blocked");
      expect(result.value.blockedReason).toBe("waiting on API access");
    }
  });

  it("an intern can unblock a task that isn't theirs", async () => {
    const { service } = makeService();
    const created = await assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    await service.setBlocked(carla, created.value.id, "reported in standup");
    const result = await service.clearBlocked(bob, created.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).not.toBe("blocked");
  });

  it("setting blocked with no reason (the /update path) works alongside setting it with one", async () => {
    const { service } = makeService();
    const withReason = await assign(service, { assigneeUsername: "alice" });
    const withoutReason = await assign(service, { assigneeUsername: "bob" });
    if (!withReason.ok || !withoutReason.ok) throw new Error("setup failed");

    const blockedWithReason = await service.setBlocked(alice, withReason.value.id, "stuck on API");
    expect(blockedWithReason.ok).toBe(true);
    if (blockedWithReason.ok) expect(blockedWithReason.value.blockedReason).toBe("stuck on API");

    // The /update <ref> blocked path goes through setStatus, which has no
    // reason parameter at all, so it must not reject for lack of one.
    const blockedNoReason = await service.setStatus(bob, withoutReason.value.id, "blocked");
    expect(blockedNoReason.ok).toBe(true);
    if (blockedNoReason.ok) expect(blockedNoReason.value.blockedReason).toBeNull();
  });

  it("block -> unblock restores the pre-block status", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.setStatus(alice, id, "in_progress");
    await service.setBlocked(alice, id, "stuck");
    const cleared = await service.clearBlocked(alice, id);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.value.status).toBe("in_progress");
      expect(cleared.value.previousStatus).toBeNull();
      expect(cleared.value.blockedReason).toBeNull();
    }
  });

  it("unblocking a task with a null previous_status lands on todo", async () => {
    const { service, store } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    // Force the task into blocked with no recorded previous_status, as if
    // it were blocked before this column existed.
    const record = await store.findTaskById(COHORT, id);
    if (!record) throw new Error("setup failed");
    await store.updateTask({ ...record, status: "blocked", previousStatus: null });

    const cleared = await service.clearBlocked(alice, id);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.status).toBe("todo");
  });

  it("the stale-previous_status trap: block from in_progress, exit via a plain setStatus to done, block again from done, then unblock — must land on done, not in_progress", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    await service.setStatus(alice, id, "in_progress");
    await service.setBlocked(alice, id, "first block");
    // Exit via a plain setStatus, not clearBlocked — must still clear
    // previous_status so it isn't stale for the next block.
    await service.setStatus(alice, id, "done");
    await service.setBlocked(alice, id, "second block");
    const cleared = await service.clearBlocked(alice, id);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.status).toBe("done");
  });

  it("re-blocking an already-blocked task does not overwrite the stashed previous_status", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    await service.setStatus(alice, id, "in_progress");
    await service.setBlocked(alice, id, "first reason");
    await service.setBlocked(alice, id, "second reason"); // already blocked
    const cleared = await service.clearBlocked(alice, id);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.status).toBe("in_progress");
  });

  it("rejects clearing a flag that isn't set", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.clearBlocked(alice, created.value.id);
    expect(result.ok).toBe(false);
  });
});

describe("overdue flag", () => {
  it("marks a task overdue when past due date and not done", async () => {
    const past = new Date("2026-09-10T02:00:00.000Z"); // well after 2026-09-05 due date
    const { service } = makeService(past);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.getTask(alice, created.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.overdue).toBe(true);
      expect(result.value.daysOverdue).toBeGreaterThanOrEqual(4);
    }
  });

  it("is not overdue before the due date", async () => {
    const { service } = makeService(NOW); // NOW is before 2026-09-05
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.getTask(alice, created.value.id);
    expect(result.ok && result.value.overdue).toBe(false);
  });

  it("a done task is never overdue even past its due date", async () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.setStatus(alice, id, "done");
    const list = await service.listAllTasks(alice);
    const task = list.ok ? list.value.find((t) => t.id === id) : undefined;
    expect(task?.overdue).toBe(false);
  });

  it("a backlog task past its due date is still overdue — backlog isn't a terminal status", async () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "backlog");
    const list = await service.listAllTasks(alice);
    const task = list.ok ? list.value.find((t) => t.id === created.value.id) : undefined;
    expect(task?.overdue).toBe(true);
  });

  it("listBacklog is cohort-wide for an intern caller, not just their own tasks", async () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    await assign(service, { assigneeUsername: "alice" });
    await assign(service, { assigneeUsername: "bob" });

    const aliceBacklog = await service.listBacklog(alice);
    expect(aliceBacklog.ok && aliceBacklog.value).toHaveLength(2);
  });
});

describe("cohort scoping", () => {
  it("listAllTasks never leaks another cohort's tasks", async () => {
    const { service } = makeService();
    await assign(service); // cohort-5
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    await service.assignTask(otherCaller, {
      assigneeUsername: "erin",
      title: "other cohort task",
      description: "d",
      dueDate: "2026-09-05",
    });

    const cohort5Tasks = await service.listAllTasks(carla);
    expect(cohort5Tasks.ok && cohort5Tasks.value).toHaveLength(1);

    const cohort4Tasks = await service.listAllTasks(otherCaller);
    expect(cohort4Tasks.ok && cohort4Tasks.value).toHaveLength(1);
  });

  it("task ids are independently sequential per cohort", async () => {
    const { service } = makeService();
    const c5task = await assign(service);
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    const c4task = await service.assignTask(otherCaller, {
      assigneeUsername: "erin",
      title: "other cohort task",
      description: "d",
      dueDate: "2026-09-05",
    });
    expect(c5task.ok && c5task.value.id).toBe(1);
    expect(c4task.ok && c4task.value.id).toBe(1);
  });
});

describe("listMyTasks", () => {
  it("a HigherUp who holds an assigned task gets it back from listMyTasks rather than a refusal", async () => {
    const { service } = makeService();
    const created = await assign(service, { assigneeUsername: "dave" });
    if (!created.ok) throw new Error("setup failed");
    const result = await service.listMyTasks(dave);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((t) => t.id === created.value.id)).toBeDefined();
    }
  });

  it("an intern's own list is unchanged", async () => {
    const { service } = makeService();
    const created = await assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    const result = await service.listMyTasks(alice);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((t) => t.id === created.value.id)).toBeDefined();
    }
  });

  it("excludes done tasks", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "done");
    const result = await service.listMyTasks(alice);
    expect(result.ok && result.value.find((t) => t.id === created.value.id)).toBeUndefined();
  });

  it("includes a backlog task — backlog is still open", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "backlog");
    const result = await service.listMyTasks(alice);
    expect(result.ok && result.value.find((t) => t.id === created.value.id)).toBeDefined();
  });
});

describe("listPending", () => {
  it("is open to any roster member, not just higher-ups", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "in_review");
    const result = await service.listPending(alice);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it("lists in_review tasks across the cohort, not just ones the caller assigned", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "in_review");
    const pending = await service.listPending(dave); // dave didn't assign it
    expect(pending.ok && pending.value).toHaveLength(1);
  });
});

describe("listBlocked", () => {
  it("returns cohort-wide rows for an intern caller, not just their own", async () => {
    const { service } = makeService();
    const aliceTask = await assign(service, { assigneeUsername: "alice" });
    const bobTask = await assign(service, { assigneeUsername: "bob" });
    if (!aliceTask.ok || !bobTask.ok) throw new Error("setup failed");
    await service.setBlocked(carla, aliceTask.value.id, "waiting on API access");
    await service.setBlocked(carla, bobTask.value.id, "waiting on design review");

    const aliceView = await service.listBlocked(alice);
    expect(aliceView.ok).toBe(true);
    if (aliceView.ok) expect(aliceView.value).toHaveLength(2);
  });

  it("excludes tasks that aren't currently blocked", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" });
    const result = await service.listBlocked(carla);
    expect(result.ok && result.value).toHaveLength(0);
  });

  it("returns cohort-wide rows for listBacklog too, with an intern caller", async () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    await assign(service, { assigneeUsername: "alice" });
    await assign(service, { assigneeUsername: "bob" });
    const result = await service.listBacklog(alice);
    expect(result.ok && result.value).toHaveLength(2);
  });
});

describe("getStats", () => {
  it("only higher-ups can view cohort stats — the dashboard's audience gate, unrelated to the workflow gates", async () => {
    const { service } = makeService();
    const result = await service.getStats(alice);
    expect(result.ok).toBe(false);
  });

  it("counts tasks completed (done) per roster member, including members with zero", async () => {
    const { service } = makeService();
    const t1 = await assign(service, { assigneeUsername: "alice" });
    const t2 = await assign(service, { assigneeUsername: "alice" });
    if (!t1.ok || !t2.ok) throw new Error("setup failed");
    await service.setStatus(alice, t1.value.id, "done");
    // t2 stays todo -> shouldn't count as completed.

    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completedPerIntern).toEqual(
      expect.arrayContaining([
        { username: "alice", completed: 1 },
        { username: "bob", completed: 0 },
      ]),
    );
  });

  it("a task assigned to a HigherUp comes back from getStats", async () => {
    const { service } = makeService();
    const created = await assign(service, { assigneeUsername: "dave" });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(dave, created.value.id, "done");

    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completedPerIntern).toEqual(
      expect.arrayContaining([{ username: "dave", completed: 1 }]),
    );
  });

  it("computes completion rate over every task — there's no more Cancelled status to exclude", async () => {
    const { service } = makeService();
    const t1 = await assign(service, { assigneeUsername: "alice" });
    const t2 = await assign(service, { assigneeUsername: "bob" });
    if (!t1.ok || !t2.ok) throw new Error("setup failed");
    await service.setStatus(alice, t1.value.id, "done");
    // t2 stays todo.

    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completionRate).toBeCloseTo(0.5);
  });

  it("computes average time-to-submit (hours) from currently-in_review tasks' createdAt/updatedAt", async () => {
    const store_ = new InMemoryTaskStore();
    const roster = makeRoster();
    const clock = { now: () => new Date("2026-08-20T00:00:00.000Z") };
    const service = new TaskService(store_, roster, clock as unknown as import("../domain/clock.js").Clock);
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Task A",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");

    // Move the clock forward 5 hours before submitting.
    clock.now = () => new Date("2026-08-20T05:00:00.000Z");
    await service.setStatus(alice, created.value.id, "in_review");

    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.averageTimeToSubmitHours).toBeCloseTo(5, 1);
  });

  it("reports null average time-to-submit when there is no in_review-status data", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" });
    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.averageTimeToSubmitHours).toBeNull();
  });

  it("counts tasks marked done within the last 7 days as completed this week", async () => {
    const { service } = makeService(new Date("2026-08-31T00:00:00.000Z"));
    const t1 = await assign(service, { assigneeUsername: "alice" });
    if (!t1.ok) throw new Error("setup failed");
    await service.setStatus(alice, t1.value.id, "done"); // "now" -> within the last 7 days

    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completedThisWeek).toBe(1);
  });

  it("scopes all stats to the caller's cohort", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" });
    const result = await service.getStats(caller("frank", "HigherUp", OTHER_COHORT));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completedPerIntern).toEqual(
      expect.arrayContaining([{ username: "erin", completed: 0 }]),
    );
    expect(result.value.completionRate).toBe(0);
  });
});

describe("dashboard higher-up login gate — must NOT be removed alongside the workflow gates", () => {
  it("stays rejecting an intern outside of TaskService entirely (pinning the check still exists)", async () => {
    // This isn't a workflow gate exercised through TaskService — it's
    // telegramLoginHandler.ts:48's audience gate (the Express dashboard's
    // dashboardServer.ts carried the same check before its removal in
    // Stage 8, #57). Pinned here as a plain role check so a future edit
    // that deletes it is caught by a grep-able assertion rather than
    // relying on an e2e dashboard test in this stage.
    const fs = await import("node:fs");
    const loginHandlerSrc = fs.readFileSync(
      new URL("../web/telegramLoginHandler.ts", import.meta.url),
      "utf8",
    );
    expect(loginHandlerSrc).toMatch(/entry\.role !== "HigherUp"/);
  });
});

describe("concurrent writes (row_version optimistic concurrency, ADR-0006)", () => {
  it("when two edits race on the same task, exactly one succeeds and the other is rejected as a conflict — never a silent lost update", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    // Both edits are issued before either has a chance to read-then-write:
    // each call's first `await` (its read of the current task) suspends
    // before the other call starts writing, so both read the same
    // pre-write rowVersion and only one of the two subsequent writes can
    // still match it.
    const [first, second] = await Promise.all([
      service.editTask(dave, id, { title: "Dave's edit" }),
      service.editTask(carla, id, { title: "Carla's edit" }),
    ]);

    const results = [first, second];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (!failed[0]!.ok) {
      expect(failed[0]!.error).toMatch(/changed by someone else/i);
    }

    // The stored task reflects whichever write actually won — never a
    // merge of the two, and never silently the loser's title.
    const final = await service.getTask(carla, id);
    expect(final.ok).toBe(true);
    if (final.ok && succeeded[0]!.ok) {
      expect(final.value.title).toBe(succeeded[0]!.value.title);
    }
  });
});

describe("listTasksForMember (issue #33 — /tasks @username)", () => {
  it("returns only the named member's tasks, cohort-wide regardless of caller role", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice", title: "alice's task" });
    await assign(service, { assigneeUsername: "bob", title: "bob's task" });

    const result = await service.listTasksForMember(bob, "alice");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.title).toBe("alice's task");
    }
  });

  it("accepts a leading @", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" });
    const result = await service.listTasksForMember(carla, "@alice");
    expect(result.ok && result.value).toHaveLength(1);
  });

  it("rejects a username that isn't on the roster in this cohort", async () => {
    const { service } = makeService();
    const result = await service.listTasksForMember(carla, "nobody");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/isn't a known roster member/i);
  });

  it("never leaks another cohort's tasks even when a username is shared across cohorts", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" }); // cohort-5
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    await service.assignTask(otherCaller, {
      assigneeUsername: "erin",
      title: "other cohort task",
      description: "d",
      dueDate: "2026-09-05",
    });

    const result = await service.listTasksForMember(otherCaller, "erin");
    expect(result.ok && result.value).toHaveLength(1);
  });
});

describe("listTasksForRole (issue #33 — /tasks intern|higherup)", () => {
  it("filters to tasks assigned to interns only", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" }); // Intern
    await assign(service, { assigneeUsername: "dave" }); // HigherUp

    const result = await service.listTasksForRole(carla, "Intern");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.assigneeUsername).toBe("alice");
    }
  });

  it("filters to tasks assigned to higher-ups only", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" });
    await assign(service, { assigneeUsername: "dave" });

    const result = await service.listTasksForRole(alice, "HigherUp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.assigneeUsername).toBe("dave");
    }
  });

  it("scopes the role's roster resolution to the caller's own cohort", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" }); // cohort-5 Intern
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    // erin is an Intern in the OTHER cohort — must not bleed into cohort-5's result.
    await service.assignTask(otherCaller, {
      assigneeUsername: "erin",
      title: "other cohort task",
      description: "d",
      dueDate: "2026-09-05",
    });

    const result = await service.listTasksForRole(carla, "Intern");
    expect(result.ok && result.value.map((t) => t.title)).toEqual([
      "Write the onboarding doc",
    ]);
  });
});

describe("listDeadlines (issue #33 — /deadlines)", () => {
  it("includes an open task due within the next 7 days", async () => {
    const { service } = makeService(new Date("2026-08-30T02:00:00.000Z")); // 2026-08-30 Manila
    const created = await assign(service, { dueDate: "2026-09-05" }); // 6 days out
    if (!created.ok) throw new Error("setup failed");
    const result = await service.listDeadlines(carla);
    expect(result.ok && result.value.map((t) => t.id)).toContain(created.value.id);
  });

  it("excludes a done task even if its due date is within the window", async () => {
    const { service } = makeService(new Date("2026-08-30T02:00:00.000Z"));
    const created = await assign(service, { dueDate: "2026-09-05" });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(alice, created.value.id, "done");
    const result = await service.listDeadlines(carla);
    expect(result.ok && result.value.find((t) => t.id === created.value.id)).toBeUndefined();
  });

  it("excludes a task due more than 7 days out", async () => {
    const { service } = makeService(new Date("2026-08-30T02:00:00.000Z"));
    const created = await assign(service, { dueDate: "2026-09-10" }); // 11 days out
    if (!created.ok) throw new Error("setup failed");
    const result = await service.listDeadlines(carla);
    expect(result.ok && result.value.find((t) => t.id === created.value.id)).toBeUndefined();
  });

  it("excludes an already-overdue task", async () => {
    const { service } = makeService(new Date("2026-09-10T02:00:00.000Z")); // past due
    const created = await assign(service, { dueDate: "2026-09-05" });
    if (!created.ok) throw new Error("setup failed");
    const result = await service.listDeadlines(carla);
    expect(result.ok && result.value.find((t) => t.id === created.value.id)).toBeUndefined();
  });

  it("orders soonest due date first", async () => {
    const { service } = makeService(new Date("2026-08-30T02:00:00.000Z"));
    const later = await assign(service, { title: "later", dueDate: "2026-09-05" });
    const sooner = await assign(service, { title: "sooner", dueDate: "2026-09-01" });
    if (!later.ok || !sooner.ok) throw new Error("setup failed");
    const result = await service.listDeadlines(carla);
    expect(result.ok && result.value.map((t) => t.id)).toEqual([
      sooner.value.id,
      later.value.id,
    ]);
  });

  it("renders sensibly when nothing is due", async () => {
    const { service } = makeService();
    const result = await service.listDeadlines(carla);
    expect(result.ok && result.value).toEqual([]);
  });
});
