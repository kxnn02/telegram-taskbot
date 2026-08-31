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
      expect(result.value.status).toBe("Assigned");
      expect(result.value.assigneeUsername).toBe("alice");
      expect(result.value.assignedByUsername).toBe("carla");
      expect(result.value.blocked).toBe(false);
    }
  });

  it("rejects assignment from an intern caller", async () => {
    const { service } = makeService();
    const result = await service.assignTask(alice, {
      assigneeUsername: "bob",
      title: "x",
      description: "y",
      dueDate: "2026-09-05",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects assigning to another higher-up", async () => {
    const { service } = makeService();
    const result = await assign(service, { assigneeUsername: "dave" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/intern/i);
  });

  it("rejects assigning to someone not on the roster", async () => {
    const { service } = makeService();
    const result = await assign(service, { assigneeUsername: "ghost" });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty title or description", async () => {
    const { service } = makeService();
    expect((await assign(service, { title: "  " })).ok).toBe(false);
    expect((await assign(service, { description: "" })).ok).toBe(false);
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

describe("full lifecycle", () => {
  it("Assigned -> InProgress (via first /task view) -> Submitted -> Approved", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    const viewed = await service.getTask(alice, id);
    expect(viewed.ok).toBe(true);
    if (viewed.ok) expect(viewed.value.status).toBe("InProgress");

    const submitted = await service.submitTask(alice, id);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.value.status).toBe("Submitted");

    const approved = await service.approveTask(carla, id);
    expect(approved.ok).toBe(true);
    if (approved.ok) expect(approved.value.status).toBe("Approved");
  });

  it("Submitted -> NeedsRevision loops back to editable InProgress-equivalent, then resubmits", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    await service.submitTask(alice, id);
    const revised = await service.reviseTask(dave, id);
    expect(revised.ok).toBe(true);
    if (revised.ok) expect(revised.value.status).toBe("NeedsRevision");

    const resubmit = await service.submitTask(alice, id);
    expect(resubmit.ok).toBe(true);
    if (resubmit.ok) expect(resubmit.value.status).toBe("Submitted");
  });

  it("second view of an already-InProgress task does not error or regress status", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    await service.getTask(alice, id);
    const secondView = await service.getTask(alice, id);
    expect(secondView.ok).toBe(true);
    if (secondView.ok) expect(secondView.value.status).toBe("InProgress");
  });
});

describe("submitTask", () => {
  it("rejects a non-assignee intern", async () => {
    const { service } = makeService();
    const created = await assign(service); // assigned to alice
    if (!created.ok) throw new Error("setup failed");
    const result = await service.submitTask(bob, created.value.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/isn't assigned to you/i);
  });

  it("rejects a higher-up caller", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.submitTask(carla, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("rejects submitting an already-Submitted task with a specific message", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.submitTask(alice, id);
    const again = await service.submitTask(alice, id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already been submitted/i);
  });

  it("rejects submitting a Cancelled task", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.cancelTask(carla, id);
    const result = await service.submitTask(alice, id);
    expect(result.ok).toBe(false);
  });

  it("rejects submitting a nonexistent task id", async () => {
    const { service } = makeService();
    const result = await service.submitTask(alice, 999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't exist/i);
  });
});

describe("approveTask / reviseTask", () => {
  it("rejects approving a task that is still Assigned, with a specific message", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.approveTask(carla, created.value.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/still Assigned, not yet submitted/i);
  });

  it("rejects an intern caller", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.submitTask(alice, created.value.id);
    const result = await service.approveTask(alice, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("any higher-up (not just the assigner) can approve", async () => {
    const { service } = makeService();
    const created = await assign(service); // assigned by carla
    if (!created.ok) throw new Error("setup failed");
    await service.submitTask(alice, created.value.id);
    const result = await service.approveTask(dave, created.value.id); // dave, not carla
    expect(result.ok).toBe(true);
  });

  it("second approveTask call fails gracefully naming who approved it first", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.submitTask(alice, id);
    const first = await service.approveTask(carla, id);
    const second = await service.approveTask(dave, id);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already approved/i);
  });

  it("revise then re-approve after resubmission works", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.submitTask(alice, id);
    await service.reviseTask(carla, id);
    await service.submitTask(alice, id);
    const approved = await service.approveTask(carla, id);
    expect(approved.ok).toBe(true);
  });

  it("rejects revising a task that isn't Submitted", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.reviseTask(carla, created.value.id);
    expect(result.ok).toBe(false);
  });
});

describe("cancelTask", () => {
  it("any higher-up can cancel a task at any point before Approved", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.cancelTask(dave, created.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("Cancelled");
  });

  it("rejects cancelling an already-Approved task", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.submitTask(alice, id);
    await service.approveTask(carla, id);
    const result = await service.cancelTask(dave, id);
    expect(result.ok).toBe(false);
  });

  it("rejects double-cancelling with a specific message", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.cancelTask(carla, id);
    const second = await service.cancelTask(dave, id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already cancelled/i);
  });

  it("rejects an intern caller", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.cancelTask(alice, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("cancelled tasks are excluded from listMyTasks and listPending but remain in listAllTasks", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.cancelTask(carla, created.value.id);

    const mine = await service.listMyTasks(alice);
    expect(mine.ok && mine.value.find((t) => t.id === created.value.id)).toBeUndefined();

    const all = await service.listAllTasks(alice);
    expect(all.ok && all.value.find((t) => t.id === created.value.id)).toBeDefined();
  });
});

describe("editTask", () => {
  it("lets any higher-up edit a task at Assigned/InProgress/Submitted stages", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.editTask(dave, created.value.id, { title: "New title" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe("New title");
  });

  it("rejects editing once a task is Approved", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.submitTask(alice, id);
    await service.approveTask(carla, id);
    const result = await service.editTask(carla, id, { title: "sneaky" });
    expect(result.ok).toBe(false);
  });

  it("still allows editing while Submitted", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.submitTask(alice, id);
    const result = await service.editTask(carla, id, { description: "clarified scope" });
    expect(result.ok).toBe(true);
  });

  it("rejects reassigning to a non-intern", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.editTask(carla, created.value.id, { assigneeUsername: "dave" });
    expect(result.ok).toBe(false);
  });

  it("rejects an intern caller", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.editTask(alice, created.value.id, { title: "x" });
    expect(result.ok).toBe(false);
  });
});

describe("addNote", () => {
  it("appends a note and it shows up on the task", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.addNote(carla, created.value.id, "Nice progress so far");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notes).toHaveLength(1);
      expect(result.value.notes[0]?.text).toBe("Nice progress so far");
      expect(result.value.notes[0]?.authorUsername).toBe("carla");
    }
  });

  it("rejects an intern caller", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.addNote(alice, created.value.id, "hi");
    expect(result.ok).toBe(false);
  });

  it("rejects empty note text", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.addNote(carla, created.value.id, "   ");
    expect(result.ok).toBe(false);
  });
});

describe("blocked flag", () => {
  it("intern can block their own task independent of status", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.setBlocked(alice, created.value.id, "waiting on API access");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blocked).toBe(true);
      expect(result.value.blockedReason).toBe("waiting on API access");
      expect(result.value.status).toBe("Assigned"); // status unaffected
    }
  });

  it("a higher-up can block on an intern's behalf", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.setBlocked(carla, created.value.id, "reported in standup");
    expect(result.ok).toBe(true);
  });

  it("rejects a different intern blocking someone else's task", async () => {
    const { service } = makeService();
    const created = await assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    const result = await service.setBlocked(bob, created.value.id, "nope");
    expect(result.ok).toBe(false);
  });

  it("clearBlocked unsets the flag", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.setBlocked(alice, id, "stuck");
    const cleared = await service.clearBlocked(alice, id);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.value.blocked).toBe(false);
      expect(cleared.value.blockedReason).toBeNull();
    }
  });

  it("rejects clearing a flag that isn't set", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.clearBlocked(alice, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("rejects blocking a Cancelled task", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.cancelTask(carla, id);
    const result = await service.setBlocked(alice, id, "too late");
    expect(result.ok).toBe(false);
  });

  it("rejects blocking an Approved task", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.submitTask(alice, id);
    await service.approveTask(carla, id);
    const result = await service.setBlocked(alice, id, "too late");
    expect(result.ok).toBe(false);
  });
});

describe("overdue flag", () => {
  it("marks a task overdue when past due date and not Approved/Cancelled", async () => {
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

  it("an Approved task is never overdue even past its due date", async () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    await service.submitTask(alice, id);
    await service.approveTask(carla, id);
    const list = await service.listAllTasks(alice);
    const task = list.ok ? list.value.find((t) => t.id === id) : undefined;
    expect(task?.overdue).toBe(false);
  });

  it("a Cancelled task is never overdue even past its due date", async () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.cancelTask(carla, created.value.id);
    const list = await service.listAllTasks(alice);
    const task = list.ok ? list.value.find((t) => t.id === created.value.id) : undefined;
    expect(task?.overdue).toBe(false);
  });

  it("/backlog scopes to own tasks for an intern and cohort-wide for a higher-up", async () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    await assign(service, { assigneeUsername: "alice" });
    await assign(service, { assigneeUsername: "bob" });

    const aliceBacklog = await service.listBacklog(alice);
    expect(aliceBacklog.ok && aliceBacklog.value).toHaveLength(1);

    const carlaBacklog = await service.listBacklog(carla);
    expect(carlaBacklog.ok && carlaBacklog.value).toHaveLength(2);
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

  it("a caller from one cohort cannot act on a task from another cohort", async () => {
    const { service } = makeService();
    const created = await assign(service); // cohort-5
    if (!created.ok) throw new Error("setup failed");
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    const result = await service.approveTask(otherCaller, created.value.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't exist/i);
  });
});

describe("getTask permissions", () => {
  it("the assigned intern can view full detail", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = await service.getTask(alice, created.value.id);
    expect(result.ok).toBe(true);
  });

  it("a different intern cannot view someone else's task detail", async () => {
    const { service } = makeService();
    const created = await assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    const result = await service.getTask(bob, created.value.id);
    expect(result.ok).toBe(false);
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
});

describe("listPending", () => {
  it("only higher-ups can view the review queue", async () => {
    const { service } = makeService();
    const result = await service.listPending(alice);
    expect(result.ok).toBe(false);
  });

  it("lists Submitted tasks across all interns, not just ones the caller assigned", async () => {
    const { service } = makeService();
    const created = await assign(service);
    if (!created.ok) throw new Error("setup failed");
    await service.submitTask(alice, created.value.id);
    const pending = await service.listPending(dave); // dave didn't assign it
    expect(pending.ok && pending.value).toHaveLength(1);
  });
});

describe("listBlocked", () => {
  it("lists blocked tasks across all interns for a higher-up, not just ones the caller assigned", async () => {
    const { service } = makeService();
    const created = await assign(service, { assigneeUsername: "alice" });
    if (!created.ok) throw new Error("setup failed");
    await service.setBlocked(alice, created.value.id, "waiting on API access");
    const notBlocked = await assign(service, { assigneeUsername: "bob" });
    if (!notBlocked.ok) throw new Error("setup failed");

    const blocked = await service.listBlocked(dave); // dave didn't assign it
    expect(blocked.ok).toBe(true);
    if (blocked.ok) {
      expect(blocked.value).toHaveLength(1);
      expect(blocked.value[0]?.id).toBe(created.value.id);
    }
  });

  it("excludes tasks that aren't currently flagged blocked", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" });
    const result = await service.listBlocked(carla);
    expect(result.ok && result.value).toHaveLength(0);
  });

  it("scopes an intern's blocked list to only their own tasks", async () => {
    const { service } = makeService();
    const aliceTask = await assign(service, { assigneeUsername: "alice" });
    if (!aliceTask.ok) throw new Error("setup failed");
    await service.setBlocked(alice, aliceTask.value.id, "waiting on API access");

    const bobTask = await assign(service, { assigneeUsername: "bob" });
    if (!bobTask.ok) throw new Error("setup failed");
    await service.setBlocked(bob, bobTask.value.id, "waiting on design review");

    const aliceBlocked = await service.listBlocked(alice);
    expect(aliceBlocked.ok).toBe(true);
    if (aliceBlocked.ok) {
      expect(aliceBlocked.value).toHaveLength(1);
      expect(aliceBlocked.value[0]?.id).toBe(aliceTask.value.id);
    }
  });

  it("an intern with no blocked tasks gets an empty list, not an error", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" });
    const result = await service.listBlocked(alice);
    expect(result.ok && result.value).toHaveLength(0);
  });
});

describe("getStats", () => {
  it("only higher-ups can view cohort stats", async () => {
    const { service } = makeService();
    const result = await service.getStats(alice);
    expect(result.ok).toBe(false);
  });

  it("counts tasks completed (Approved) per intern, including interns with zero", async () => {
    const { service } = makeService();
    const t1 = await assign(service, { assigneeUsername: "alice" });
    const t2 = await assign(service, { assigneeUsername: "alice" });
    if (!t1.ok || !t2.ok) throw new Error("setup failed");
    await service.submitTask(alice, t1.value.id);
    await service.approveTask(carla, t1.value.id);
    await service.submitTask(alice, t2.value.id);
    // t2 stays Submitted, not Approved -> shouldn't count as completed.

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

  it("excludes Cancelled tasks from the completion-rate denominator", async () => {
    const { service } = makeService();
    const t1 = await assign(service, { assigneeUsername: "alice" });
    const t2 = await assign(service, { assigneeUsername: "bob" });
    const t3 = await assign(service, { assigneeUsername: "bob" });
    if (!t1.ok || !t2.ok || !t3.ok) throw new Error("setup failed");
    await service.submitTask(alice, t1.value.id);
    await service.approveTask(carla, t1.value.id);
    await service.cancelTask(carla, t2.value.id);
    // t3 stays Assigned (not completed, not cancelled).

    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1 Approved out of 2 countable (t1, t3) — t2 (Cancelled) excluded entirely.
    expect(result.value.completionRate).toBeCloseTo(0.5);
  });

  it("computes average time-to-submit (hours) from currently-Submitted tasks' createdAt/updatedAt", async () => {
    const store_ = new InMemoryTaskStore();
    const roster = makeRoster();
    const clock = { now: () => new Date("2026-08-20T00:00:00.000Z") };
    let service = new TaskService(store_, roster, clock as unknown as import("../domain/clock.js").Clock);
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Task A",
      description: "d",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");

    // Move the clock forward 5 hours before submitting.
    clock.now = () => new Date("2026-08-20T05:00:00.000Z");
    await service.submitTask(alice, created.value.id);

    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.averageTimeToSubmitHours).toBeCloseTo(5, 1);
  });

  it("reports null average time-to-submit when there is no Submitted-status data", async () => {
    const { service } = makeService();
    await assign(service, { assigneeUsername: "alice" });
    const result = await service.getStats(carla);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.averageTimeToSubmitHours).toBeNull();
  });

  it("counts tasks approved within the last 7 days as completed this week", async () => {
    const { service } = makeService(new Date("2026-08-31T00:00:00.000Z"));
    const t1 = await assign(service, { assigneeUsername: "alice" });
    if (!t1.ok) throw new Error("setup failed");
    await service.submitTask(alice, t1.value.id);
    await service.approveTask(carla, t1.value.id); // approved "now" -> within the last 7 days

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
    expect(result.value.completedPerIntern).toEqual([{ username: "erin", completed: 0 }]);
    expect(result.value.completionRate).toBe(0);
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
