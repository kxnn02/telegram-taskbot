import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "../domain/types.js";
import type { TaskStorePort } from "./taskStorePort.js";

/** What a concrete `TaskStorePort` implementation's test setup hands back
 * to the shared contract suite: a store instance plus two distinct cohort
 * ids it's safe to write to and read back for the duration of one test. */
export interface ContractFixture {
  store: TaskStorePort;
  cohortId: string;
  otherCohortId: string;
}

function makeTask(cohortId: string, overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    cohortId,
    title: "Write the onboarding doc",
    description: "Draft the intern onboarding checklist",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05",
    status: "todo",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    priority: "medium",
    orderIndex: 0,
    createdAt: "2026-08-31T02:00:00.000Z",
    updatedAt: "2026-08-31T02:00:00.000Z",
    ...overrides,
  };
}

/**
 * The `TaskStorePort` contract (ADR-0005/ADR-0006), shared between
 * `InMemoryTaskStore` (fast, offline) and `SupabaseTaskStore` (slower, hits
 * the real project) — every rule here must hold for both, so the fake
 * stays trustworthy as a stand-in and the real adapter can't silently
 * diverge from what `TaskService` actually relies on.
 *
 * `setup` runs before each test and must return a fresh, empty-as-far-as-
 * these-tests-are-concerned fixture; `teardown` (if given) runs after each
 * test to clean up whatever `setup` created — required for a backend with
 * a permanent footprint (e.g. the real Supabase project), a no-op for a
 * purely in-memory one.
 */
export function runTaskStoreContractTests(
  label: string,
  setup: () => Promise<ContractFixture> | ContractFixture,
  teardown?: (fixture: ContractFixture) => Promise<void> | void,
): void {
  describe(`TaskStorePort contract — ${label}`, () => {
    let fixture: ContractFixture;

    beforeEach(async () => {
      fixture = await setup();
    });

    afterEach(async () => {
      if (teardown) await teardown(fixture);
    });

    describe("nextId", () => {
      it("allocates sequential ids scoped per cohort", async () => {
        const { store, cohortId, otherCohortId } = fixture;
        expect(await store.nextId(cohortId)).toBe(1);
        expect(await store.nextId(cohortId)).toBe(2);
        expect(await store.nextId(otherCohortId)).toBe(1);
      });
    });

    describe("insertTask / findTaskById / listTasksByCohort", () => {
      it("inserts a task at rowVersion 1 and finds it back by cohort + id", async () => {
        const { store, cohortId } = fixture;
        const inserted = await store.insertTask(makeTask(cohortId));
        expect(inserted.rowVersion).toBe(1);

        const found = await store.findTaskById(cohortId, 1);
        expect(found).toBeDefined();
        expect(found?.rowVersion).toBe(1);
        expect(found?.title).toBe("Write the onboarding doc");
      });

      it("returns undefined for a task that doesn't exist", async () => {
        const { store, cohortId } = fixture;
        expect(await store.findTaskById(cohortId, 999)).toBeUndefined();
      });

      it("scopes listTasksByCohort and orders by id ascending", async () => {
        const { store, cohortId, otherCohortId } = fixture;
        await store.insertTask(makeTask(cohortId, { id: 2 }));
        await store.insertTask(makeTask(cohortId, { id: 1 }));
        await store.insertTask(makeTask(otherCohortId, { id: 1 }));

        const own = await store.listTasksByCohort(cohortId);
        expect(own.map((t) => t.id)).toEqual([1, 2]);

        const other = await store.listTasksByCohort(otherCohortId);
        expect(other).toHaveLength(1);
      });
    });

    describe("updateTask — row_version optimistic concurrency (ADR-0006)", () => {
      it("succeeds and increments rowVersion when the expected version matches", async () => {
        const { store, cohortId } = fixture;
        const inserted = await store.insertTask(makeTask(cohortId));

        const result = await store.updateTask({ ...inserted, title: "Updated title" });

        expect(result.outcome).toBe("updated");
        if (result.outcome === "updated") {
          expect(result.task.rowVersion).toBe(2);
          expect(result.task.title).toBe("Updated title");
        }
      });

      it("rejects a write based on a stale rowVersion with a conflict outcome, and leaves the stored row untouched", async () => {
        const { store, cohortId } = fixture;
        const inserted = await store.insertTask(makeTask(cohortId));

        // Someone else's write lands first, bumping the row to version 2.
        const firstWrite = await store.updateTask({ ...inserted, title: "First writer's title" });
        expect(firstWrite.outcome).toBe("updated");

        // A second writer who read the task before that write attempts to
        // save based on the stale version 1 — must be rejected, not
        // silently overwrite the first writer's change.
        const staleWrite = await store.updateTask({ ...inserted, title: "Stale writer's title" });
        expect(staleWrite.outcome).toBe("conflict");

        const current = await store.findTaskById(cohortId, inserted.id);
        expect(current?.title).toBe("First writer's title");
        expect(current?.rowVersion).toBe(2);
      });

      it("reports a conflict for a task that no longer exists", async () => {
        const { store, cohortId } = fixture;
        const result = await store.updateTask({ ...makeTask(cohortId), rowVersion: 1 });
        expect(result.outcome).toBe("conflict");
      });

      it("does not persist changes to notes via updateTask — notes are appended separately", async () => {
        const { store, cohortId } = fixture;
        const inserted = await store.insertTask(makeTask(cohortId));
        await store.insertNote(cohortId, inserted.id, {
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

    describe("priority (issue #101)", () => {
      it("stores 'medium' when insertTask isn't given a priority", async () => {
        const { store, cohortId } = fixture;
        const inserted = await store.insertTask(makeTask(cohortId));
        expect(inserted.priority).toBe("medium");
      });

      it("round-trips a non-default priority through insertTask/findTaskById", async () => {
        const { store, cohortId } = fixture;
        await store.insertTask(makeTask(cohortId, { priority: "urgent" }));
        const found = await store.findTaskById(cohortId, 1);
        expect(found?.priority).toBe("urgent");
      });

      it("updateTask changes priority and bumps rowVersion, same as any other field", async () => {
        const { store, cohortId } = fixture;
        const inserted = await store.insertTask(makeTask(cohortId));

        const result = await store.updateTask({ ...inserted, priority: "high" });

        expect(result.outcome).toBe("updated");
        if (result.outcome === "updated") {
          expect(result.task.priority).toBe("high");
          expect(result.task.rowVersion).toBe(2);
        }
      });
    });

    describe("insertNote", () => {
      it("appends notes visible on subsequent finds", async () => {
        const { store, cohortId } = fixture;
        const inserted = await store.insertTask(makeTask(cohortId));
        await store.insertNote(cohortId, inserted.id, {
          text: "First note",
          authorUsername: "carla",
          createdAt: "2026-08-31T03:00:00.000Z",
        });
        await store.insertNote(cohortId, inserted.id, {
          text: "Second note",
          authorUsername: "dave",
          createdAt: "2026-08-31T04:00:00.000Z",
        });

        const found = await store.findTaskById(cohortId, inserted.id);
        expect(found?.notes.map((n) => n.text)).toEqual(["First note", "Second note"]);
      });
    });
  });
}
