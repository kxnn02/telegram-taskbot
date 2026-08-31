import { describe, expect, it } from "vitest";
import type { Task } from "../domain/types.js";
import { InMemoryTaskStore } from "./inMemoryTaskStore.js";

const COHORT = "cohort-5";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    cohortId: COHORT,
    title: "Write the onboarding doc",
    description: "Draft the intern onboarding checklist",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05",
    status: "Assigned",
    notes: [],
    blocked: false,
    blockedReason: null,
    createdAt: "2026-08-31T02:00:00.000Z",
    updatedAt: "2026-08-31T02:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryTaskStore.nextId", () => {
  it("allocates sequential ids scoped per cohort", async () => {
    const store = new InMemoryTaskStore();
    expect(await store.nextId(COHORT)).toBe(1);
    expect(await store.nextId(COHORT)).toBe(2);
    expect(await store.nextId("cohort-4")).toBe(1);
  });
});

describe("InMemoryTaskStore.insertTask / findTaskById / listTasksByCohort", () => {
  it("inserts a task at rowVersion 1 and finds it back by cohort + id", async () => {
    const store = new InMemoryTaskStore();
    const inserted = await store.insertTask(makeTask());
    expect(inserted.rowVersion).toBe(1);

    const found = await store.findTaskById(COHORT, 1);
    expect(found).toBeDefined();
    expect(found?.rowVersion).toBe(1);
    expect(found?.title).toBe("Write the onboarding doc");
  });

  it("returns undefined for a task that doesn't exist", async () => {
    const store = new InMemoryTaskStore();
    expect(await store.findTaskById(COHORT, 999)).toBeUndefined();
  });

  it("scopes listTasksByCohort and orders by id ascending", async () => {
    const store = new InMemoryTaskStore();
    await store.insertTask(makeTask({ id: 2 }));
    await store.insertTask(makeTask({ id: 1 }));
    await store.insertTask(makeTask({ id: 1, cohortId: "cohort-4" }));

    const cohort5 = await store.listTasksByCohort(COHORT);
    expect(cohort5.map((t) => t.id)).toEqual([1, 2]);

    const cohort4 = await store.listTasksByCohort("cohort-4");
    expect(cohort4).toHaveLength(1);
  });
});

describe("InMemoryTaskStore.updateTask — row_version optimistic concurrency (ADR-0006)", () => {
  it("succeeds and increments rowVersion when the expected version matches", async () => {
    const store = new InMemoryTaskStore();
    const inserted = await store.insertTask(makeTask());

    const result = await store.updateTask({ ...inserted, title: "Updated title" });

    expect(result.outcome).toBe("updated");
    if (result.outcome === "updated") {
      expect(result.task.rowVersion).toBe(2);
      expect(result.task.title).toBe("Updated title");
    }
  });

  it("rejects a write based on a stale rowVersion with a conflict outcome, and leaves the stored row untouched", async () => {
    const store = new InMemoryTaskStore();
    const inserted = await store.insertTask(makeTask());

    // Someone else's write lands first, bumping the row to version 2.
    const firstWrite = await store.updateTask({ ...inserted, title: "First writer's title" });
    expect(firstWrite.outcome).toBe("updated");

    // A second writer who read the task before that write attempts to
    // save based on the stale version 1 — must be rejected, not silently
    // overwrite the first writer's change.
    const staleWrite = await store.updateTask({ ...inserted, title: "Stale writer's title" });
    expect(staleWrite.outcome).toBe("conflict");

    const current = await store.findTaskById(COHORT, inserted.id);
    expect(current?.title).toBe("First writer's title");
    expect(current?.rowVersion).toBe(2);
  });

  it("reports a conflict for a task that no longer exists", async () => {
    const store = new InMemoryTaskStore();
    const result = await store.updateTask({ ...makeTask(), rowVersion: 1 });
    expect(result.outcome).toBe("conflict");
  });

  it("does not persist changes to notes via updateTask — notes are appended separately", async () => {
    const store = new InMemoryTaskStore();
    const inserted = await store.insertTask(makeTask());
    await store.insertNote(COHORT, inserted.id, {
      text: "Nice progress",
      authorUsername: "carla",
      createdAt: "2026-08-31T03:00:00.000Z",
    });

    // Attempting to smuggle a notes change through updateTask must not
    // clobber the append-only note log.
    const result = await store.updateTask({ ...inserted, notes: [] });
    expect(result.outcome).toBe("updated");
    if (result.outcome === "updated") {
      expect(result.task.notes).toHaveLength(1);
    }
  });
});

describe("InMemoryTaskStore.insertNote", () => {
  it("appends notes visible on subsequent finds", async () => {
    const store = new InMemoryTaskStore();
    const inserted = await store.insertTask(makeTask());
    await store.insertNote(COHORT, inserted.id, {
      text: "First note",
      authorUsername: "carla",
      createdAt: "2026-08-31T03:00:00.000Z",
    });
    await store.insertNote(COHORT, inserted.id, {
      text: "Second note",
      authorUsername: "dave",
      createdAt: "2026-08-31T04:00:00.000Z",
    });

    const found = await store.findTaskById(COHORT, inserted.id);
    expect(found?.notes.map((n) => n.text)).toEqual(["First note", "Second note"]);
  });
});
