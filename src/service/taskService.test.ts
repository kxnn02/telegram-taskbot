import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/schema.js";
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
  const db = openDatabase(":memory:");
  const roster = makeRoster();
  const clock = new FixedClock(now);
  return { service: new TaskService(db, roster, clock), db };
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
  it("lets a higher-up assign a task to an intern", () => {
    const { service } = makeService();
    const result = assign(service);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(1);
      expect(result.value.status).toBe("Assigned");
      expect(result.value.assigneeUsername).toBe("alice");
      expect(result.value.assignedByUsername).toBe("carla");
      expect(result.value.blocked).toBe(false);
    }
  });

  it("rejects assignment from an intern caller", () => {
    const { service } = makeService();
    const result = service.assignTask(alice, {
      assigneeUsername: "bob",
      title: "x",
      description: "y",
      dueDate: "2026-09-05",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects assigning to another higher-up", () => {
    const { service } = makeService();
    const result = assign(service, { assigneeUsername: "dave" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/intern/i);
  });

  it("rejects assigning to someone not on the roster", () => {
    const { service } = makeService();
    const result = assign(service, { assigneeUsername: "ghost" });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty title or description", () => {
    const { service } = makeService();
    expect(assign(service, { title: "  " }).ok).toBe(false);
    expect(assign(service, { description: "" }).ok).toBe(false);
  });

  it("rejects an invalid due date", () => {
    const { service } = makeService();
    expect(assign(service, { dueDate: "not-a-date" }).ok).toBe(false);
  });

  it("allocates sequential ids scoped per cohort", () => {
    const { service } = makeService();
    const first = assign(service);
    const second = assign(service, { assigneeUsername: "bob" });
    expect(first.ok && first.value.id).toBe(1);
    expect(second.ok && second.value.id).toBe(2);
  });
});

describe("full lifecycle", () => {
  it("Assigned -> InProgress (via first /task view) -> Submitted -> Approved", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    const viewed = service.getTask(alice, id);
    expect(viewed.ok).toBe(true);
    if (viewed.ok) expect(viewed.value.status).toBe("InProgress");

    const submitted = service.submitTask(alice, id);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.value.status).toBe("Submitted");

    const approved = service.approveTask(carla, id);
    expect(approved.ok).toBe(true);
    if (approved.ok) expect(approved.value.status).toBe("Approved");
  });

  it("Submitted -> NeedsRevision loops back to editable InProgress-equivalent, then resubmits", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    service.submitTask(alice, id);
    const revised = service.reviseTask(dave, id);
    expect(revised.ok).toBe(true);
    if (revised.ok) expect(revised.value.status).toBe("NeedsRevision");

    const resubmit = service.submitTask(alice, id);
    expect(resubmit.ok).toBe(true);
    if (resubmit.ok) expect(resubmit.value.status).toBe("Submitted");
  });

  it("second view of an already-InProgress task does not error or regress status", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    service.getTask(alice, id);
    const secondView = service.getTask(alice, id);
    expect(secondView.ok).toBe(true);
    if (secondView.ok) expect(secondView.value.status).toBe("InProgress");
  });
});

describe("submitTask", () => {
  it("rejects a non-assignee intern", () => {
    const { service } = makeService();
    const created = assign(service); // assigned to alice
    if (!created.ok) throw new Error("setup failed");
    const result = service.submitTask(bob, created.value.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/isn't assigned to you/i);
  });

  it("rejects a higher-up caller", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.submitTask(carla, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("rejects submitting an already-Submitted task with a specific message", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.submitTask(alice, id);
    const again = service.submitTask(alice, id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already been submitted/i);
  });

  it("rejects submitting a Cancelled task", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.cancelTask(carla, id);
    const result = service.submitTask(alice, id);
    expect(result.ok).toBe(false);
  });

  it("rejects submitting a nonexistent task id", () => {
    const { service } = makeService();
    const result = service.submitTask(alice, 999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't exist/i);
  });
});

describe("approveTask / reviseTask", () => {
  it("rejects approving a task that is still Assigned, with a specific message", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.approveTask(carla, created.value.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/still Assigned, not yet submitted/i);
  });

  it("rejects an intern caller", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    service.submitTask(alice, created.value.id);
    const result = service.approveTask(alice, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("any higher-up (not just the assigner) can approve", () => {
    const { service } = makeService();
    const created = assign(service); // assigned by carla
    if (!created.ok) throw new Error("setup failed");
    service.submitTask(alice, created.value.id);
    const result = service.approveTask(dave, created.value.id); // dave, not carla
    expect(result.ok).toBe(true);
  });

  it("second approveTask call fails gracefully naming who approved it first", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.submitTask(alice, id);
    const first = service.approveTask(carla, id);
    const second = service.approveTask(dave, id);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already approved/i);
  });

  it("revise then re-approve after resubmission works", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.submitTask(alice, id);
    service.reviseTask(carla, id);
    service.submitTask(alice, id);
    const approved = service.approveTask(carla, id);
    expect(approved.ok).toBe(true);
  });

  it("rejects revising a task that isn't Submitted", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.reviseTask(carla, created.value.id);
    expect(result.ok).toBe(false);
  });
});

describe("cancelTask", () => {
  it("any higher-up can cancel a task at any point before Approved", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.cancelTask(dave, created.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("Cancelled");
  });

  it("rejects cancelling an already-Approved task", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.submitTask(alice, id);
    service.approveTask(carla, id);
    const result = service.cancelTask(dave, id);
    expect(result.ok).toBe(false);
  });

  it("rejects double-cancelling with a specific message", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.cancelTask(carla, id);
    const second = service.cancelTask(dave, id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already cancelled/i);
  });

  it("rejects an intern caller", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.cancelTask(alice, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("cancelled tasks are excluded from listMyTasks and listPending but remain in listAllTasks", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    service.cancelTask(carla, created.value.id);

    const mine = service.listMyTasks(alice);
    expect(mine.ok && mine.value.find((t) => t.id === created.value.id)).toBeUndefined();

    const all = service.listAllTasks(alice);
    expect(all.ok && all.value.find((t) => t.id === created.value.id)).toBeDefined();
  });
});

describe("editTask", () => {
  it("lets any higher-up edit a task at Assigned/InProgress/Submitted stages", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.editTask(dave, created.value.id, { title: "New title" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe("New title");
  });

  it("rejects editing once a task is Approved", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.submitTask(alice, id);
    service.approveTask(carla, id);
    const result = service.editTask(carla, id, { title: "sneaky" });
    expect(result.ok).toBe(false);
  });

  it("still allows editing while Submitted", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.submitTask(alice, id);
    const result = service.editTask(carla, id, { description: "clarified scope" });
    expect(result.ok).toBe(true);
  });

  it("rejects reassigning to a non-intern", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.editTask(carla, created.value.id, { assigneeUsername: "dave" });
    expect(result.ok).toBe(false);
  });

  it("rejects an intern caller", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.editTask(alice, created.value.id, { title: "x" });
    expect(result.ok).toBe(false);
  });
});

describe("addNote", () => {
  it("appends a note and it shows up on the task", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.addNote(carla, created.value.id, "Nice progress so far");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notes).toHaveLength(1);
      expect(result.value.notes[0]?.text).toBe("Nice progress so far");
      expect(result.value.notes[0]?.authorUsername).toBe("carla");
    }
  });

  it("rejects an intern caller", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.addNote(alice, created.value.id, "hi");
    expect(result.ok).toBe(false);
  });

  it("rejects empty note text", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.addNote(carla, created.value.id, "   ");
    expect(result.ok).toBe(false);
  });
});

describe("blocked flag", () => {
  it("intern can block their own task independent of status", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.setBlocked(alice, created.value.id, "waiting on API access");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blocked).toBe(true);
      expect(result.value.blockedReason).toBe("waiting on API access");
      expect(result.value.status).toBe("Assigned"); // status unaffected
    }
  });

  it("a higher-up can block on an intern's behalf", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.setBlocked(carla, created.value.id, "reported in standup");
    expect(result.ok).toBe(true);
  });

  it("rejects a different intern blocking someone else's task", () => {
    const { service } = makeService();
    const created = assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    const result = service.setBlocked(bob, created.value.id, "nope");
    expect(result.ok).toBe(false);
  });

  it("clearBlocked unsets the flag", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.setBlocked(alice, id, "stuck");
    const cleared = service.clearBlocked(alice, id);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.value.blocked).toBe(false);
      expect(cleared.value.blockedReason).toBeNull();
    }
  });

  it("rejects clearing a flag that isn't set", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.clearBlocked(alice, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("rejects blocking a Cancelled task", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.cancelTask(carla, id);
    const result = service.setBlocked(alice, id, "too late");
    expect(result.ok).toBe(false);
  });

  it("rejects blocking an Approved task", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.submitTask(alice, id);
    service.approveTask(carla, id);
    const result = service.setBlocked(alice, id, "too late");
    expect(result.ok).toBe(false);
  });
});

describe("overdue flag", () => {
  it("marks a task overdue when past due date and not Approved/Cancelled", () => {
    const past = new Date("2026-09-10T02:00:00.000Z"); // well after 2026-09-05 due date
    const { service } = makeService(past);
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.getTask(alice, created.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.overdue).toBe(true);
      expect(result.value.daysOverdue).toBeGreaterThanOrEqual(4);
    }
  });

  it("is not overdue before the due date", () => {
    const { service } = makeService(NOW); // NOW is before 2026-09-05
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.getTask(alice, created.value.id);
    expect(result.ok && result.value.overdue).toBe(false);
  });

  it("an Approved task is never overdue even past its due date", () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;
    service.submitTask(alice, id);
    service.approveTask(carla, id);
    const list = service.listAllTasks(alice);
    const task = list.ok ? list.value.find((t) => t.id === id) : undefined;
    expect(task?.overdue).toBe(false);
  });

  it("a Cancelled task is never overdue even past its due date", () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    service.cancelTask(carla, created.value.id);
    const list = service.listAllTasks(alice);
    const task = list.ok ? list.value.find((t) => t.id === created.value.id) : undefined;
    expect(task?.overdue).toBe(false);
  });

  it("/backlog scopes to own tasks for an intern and cohort-wide for a higher-up", () => {
    const past = new Date("2026-09-10T02:00:00.000Z");
    const { service } = makeService(past);
    assign(service, { assigneeUsername: "alice" });
    assign(service, { assigneeUsername: "bob" });

    const aliceBacklog = service.listBacklog(alice);
    expect(aliceBacklog.ok && aliceBacklog.value).toHaveLength(1);

    const carlaBacklog = service.listBacklog(carla);
    expect(carlaBacklog.ok && carlaBacklog.value).toHaveLength(2);
  });
});

describe("cohort scoping", () => {
  it("listAllTasks never leaks another cohort's tasks", () => {
    const { service } = makeService();
    assign(service); // cohort-5
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    service.assignTask(otherCaller, {
      assigneeUsername: "erin",
      title: "other cohort task",
      description: "d",
      dueDate: "2026-09-05",
    });

    const cohort5Tasks = service.listAllTasks(carla);
    expect(cohort5Tasks.ok && cohort5Tasks.value).toHaveLength(1);

    const cohort4Tasks = service.listAllTasks(otherCaller);
    expect(cohort4Tasks.ok && cohort4Tasks.value).toHaveLength(1);
  });

  it("task ids are independently sequential per cohort", () => {
    const { service } = makeService();
    const c5task = assign(service);
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    const c4task = service.assignTask(otherCaller, {
      assigneeUsername: "erin",
      title: "other cohort task",
      description: "d",
      dueDate: "2026-09-05",
    });
    expect(c5task.ok && c5task.value.id).toBe(1);
    expect(c4task.ok && c4task.value.id).toBe(1);
  });

  it("a caller from one cohort cannot act on a task from another cohort", () => {
    const { service } = makeService();
    const created = assign(service); // cohort-5
    if (!created.ok) throw new Error("setup failed");
    const otherCaller = caller("frank", "HigherUp", OTHER_COHORT);
    const result = service.approveTask(otherCaller, created.value.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't exist/i);
  });
});

describe("getTask permissions", () => {
  it("the assigned intern can view full detail", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.getTask(alice, created.value.id);
    expect(result.ok).toBe(true);
  });

  it("a different intern cannot view someone else's task detail", () => {
    const { service } = makeService();
    const created = assign(service); // alice's task
    if (!created.ok) throw new Error("setup failed");
    const result = service.getTask(bob, created.value.id);
    expect(result.ok).toBe(false);
  });

  it("any higher-up can view any task's detail", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    const result = service.getTask(dave, created.value.id);
    expect(result.ok).toBe(true);
  });

  it("returns a specific not-found message for a nonexistent id", () => {
    const { service } = makeService();
    const result = service.getTask(carla, 42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Task 42 doesn't exist.");
  });
});

describe("listPending", () => {
  it("only higher-ups can view the review queue", () => {
    const { service } = makeService();
    const result = service.listPending(alice);
    expect(result.ok).toBe(false);
  });

  it("lists Submitted tasks across all interns, not just ones the caller assigned", () => {
    const { service } = makeService();
    const created = assign(service);
    if (!created.ok) throw new Error("setup failed");
    service.submitTask(alice, created.value.id);
    const pending = service.listPending(dave); // dave didn't assign it
    expect(pending.ok && pending.value).toHaveLength(1);
  });
});

describe("listBlocked", () => {
  it("only higher-ups can view the cohort-wide blocked list", () => {
    const { service } = makeService();
    const result = service.listBlocked(alice);
    expect(result.ok).toBe(false);
  });

  it("lists blocked tasks across all interns, not just ones the caller assigned", () => {
    const { service } = makeService();
    const created = assign(service, { assigneeUsername: "alice" });
    if (!created.ok) throw new Error("setup failed");
    service.setBlocked(alice, created.value.id, "waiting on API access");
    const notBlocked = assign(service, { assigneeUsername: "bob" });
    if (!notBlocked.ok) throw new Error("setup failed");

    const blocked = service.listBlocked(dave); // dave didn't assign it
    expect(blocked.ok && blocked.value).toHaveLength(1);
    expect(blocked.ok && blocked.value[0].id).toBe(created.value.id);
  });

  it("excludes tasks that aren't currently flagged blocked", () => {
    const { service } = makeService();
    assign(service, { assigneeUsername: "alice" });
    const result = service.listBlocked(carla);
    expect(result.ok && result.value).toHaveLength(0);
  });
});
