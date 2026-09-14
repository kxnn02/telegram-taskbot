import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Task } from "../domain/types.js";
import { SupabaseTaskStore } from "./supabaseTaskStore.js";

/**
 * N+1 regression tests for listTasksByCohort (issue #189).
 *
 * These tests verify that listTasksByCohort fetches notes in a single batch query,
 * not N individual queries, and that chunking works correctly for large task lists.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).
 */

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "supabaseTaskStore.n-plus-one.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);
let cohortIds: string[] = [];

async function makeCohort(): Promise<string> {
  const cohortId = `__n_plus_one_test_${randomUUID().slice(0, 8)}__`;
  const { error } = await client
    .from("cohorts")
    .insert({ cohort_id: cohortId, name: "N+1 regression test cohort" });
  if (error) throw new Error(`Failed to create test cohort: ${error.message}`);
  cohortIds.push(cohortId);
  return cohortId;
}

function makeTask(cohortId: string, id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    cohortId,
    title: `Task ${id}`,
    description: `Description for task ${id}`,
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-15",
    status: "todo",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    priority: "medium",
    orderIndex: id - 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

async function teardown(): Promise<void> {
  if (cohortIds.length === 0) return;
  const { error } = await client.from("cohorts").delete().in("cohort_id", cohortIds);
  if (error) {
    throw new Error(
      `Failed to clean up test cohorts ${cohortIds.join(", ")}: ${error.message}`,
    );
  }
}

describe("SupabaseTaskStore.listTasksByCohort — N+1 regression (issue #189)", () => {
  afterEach(async () => {
    await teardown();
  });

  it("test 1: returns tasks with their notes correctly attached — each task gets its own notes", async () => {
    const cohortId = await makeCohort();
    const store = new SupabaseTaskStore(client);

    // Insert 3 tasks: task 1 with 2 notes, task 2 with 1 note, task 3 with 0 notes
    const task1 = await store.insertTask(makeTask(cohortId, 1));
    await store.insertNote(cohortId, task1.id, {
      text: "First note on task 1",
      authorUsername: "bob",
      createdAt: "2026-09-01T10:00:00.000Z",
    });
    await store.insertNote(cohortId, task1.id, {
      text: "Second note on task 1",
      authorUsername: "charlie",
      createdAt: "2026-09-01T11:00:00.000Z",
    });

    const task2 = await store.insertTask(makeTask(cohortId, 2));
    await store.insertNote(cohortId, task2.id, {
      text: "Only note on task 2",
      authorUsername: "dave",
      createdAt: "2026-09-01T12:00:00.000Z",
    });

    const task3 = await store.insertTask(makeTask(cohortId, 3));
    // task3 has no notes

    const tasks = await store.listTasksByCohort(cohortId);

    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.notes).toHaveLength(2);
    expect(tasks[0]!.notes[0]!.text).toBe("First note on task 1");
    expect(tasks[0]!.notes[1]!.text).toBe("Second note on task 1");
    expect(tasks[1]!.notes).toHaveLength(1);
    expect(tasks[1]!.notes[0]!.text).toBe("Only note on task 2");
    expect(tasks[2]!.notes).toHaveLength(0);
  });

  it("test 2: a task with no notes gets an empty array, not undefined", async () => {
    const cohortId = await makeCohort();
    const store = new SupabaseTaskStore(client);

    const task = await store.insertTask(makeTask(cohortId, 1));
    const tasks = await store.listTasksByCohort(cohortId);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.notes).toBeDefined();
    expect(Array.isArray(tasks[0]!.notes)).toBe(true);
    expect(tasks[0]!.notes).toHaveLength(0);
  });

  it("test 3: notes within a task come back in note_id ascending order", async () => {
    const cohortId = await makeCohort();
    const store = new SupabaseTaskStore(client);

    const task = await store.insertTask(makeTask(cohortId, 1));

    // Insert notes in order; they should come back in note_id (insertion) order
    await store.insertNote(cohortId, task.id, {
      text: "First note",
      authorUsername: "alice",
      createdAt: "2026-09-01T10:00:00.000Z",
    });
    await store.insertNote(cohortId, task.id, {
      text: "Second note",
      authorUsername: "bob",
      createdAt: "2026-09-01T11:00:00.000Z",
    });
    await store.insertNote(cohortId, task.id, {
      text: "Third note",
      authorUsername: "charlie",
      createdAt: "2026-09-01T12:00:00.000Z",
    });

    const tasks = await store.listTasksByCohort(cohortId);
    expect(tasks[0]!.notes.map((n) => n.text)).toEqual(["First note", "Second note", "Third note"]);
  });

  it("test 4: with 5 tasks, the notes table is queried exactly ONCE (regression test for N+1)", async () => {
    const cohortId = await makeCohort();
    const store = new SupabaseTaskStore(client);

    // Insert 5 tasks with varying numbers of notes
    for (let i = 1; i <= 5; i++) {
      const task = await store.insertTask(makeTask(cohortId, i));
      // Varying note counts: task 1 has 0, task 2 has 1, task 3 has 0, task 4 has 2, task 5 has 1
      const noteCount = [0, 1, 0, 2, 1][i - 1] ?? 0;
      for (let j = 0; j < noteCount; j++) {
        const hour = String(10 + i + j).padStart(2, "0");
        await store.insertNote(cohortId, task.id, {
          text: `Note ${j + 1} on task ${i}`,
          authorUsername: "alice",
          createdAt: `2026-09-01T${hour}:00:00.000Z`,
        });
      }
    }

    // Spy on the from() method to count calls to the notes table
    let notesQueryCount = 0;
    const originalFrom = client.from.bind(client);
    const fromSpy = vi.spyOn(client, "from");
    fromSpy.mockImplementation((...args) => {
      const table = args[0];
      if (table === "notes") {
        notesQueryCount++;
      }
      return originalFrom(...args);
    });

    try {
      await store.listTasksByCohort(cohortId);
      expect(notesQueryCount).toBe(1);
    } finally {
      fromSpy.mockRestore();
    }
  });

  it("test 5: empty cohort queries the notes table ZERO times and returns empty array", async () => {
    const cohortId = await makeCohort();
    const store = new SupabaseTaskStore(client);

    // Don't insert any tasks

    // Spy on the from() method to count calls to the notes table
    let notesQueryCount = 0;
    const originalFrom = client.from.bind(client);
    const fromSpy = vi.spyOn(client, "from");
    fromSpy.mockImplementation((...args) => {
      const table = args[0];
      if (table === "notes") {
        notesQueryCount++;
      }
      return originalFrom(...args);
    });

    try {
      const tasks = await store.listTasksByCohort(cohortId);
      expect(tasks).toHaveLength(0);
      expect(notesQueryCount).toBe(0);
    } finally {
      fromSpy.mockRestore();
    }
  });

  it(
    "test 6: chunking with 250 task ids queries the notes table exactly TWICE",
    async () => {
      const cohortId = await makeCohort();
      const store = new SupabaseTaskStore(client);

      // Insert 250 tasks (200 in first chunk, 50 in second chunk)
      for (let i = 1; i <= 250; i++) {
        await store.insertTask(makeTask(cohortId, i));
      }

      // Spy on the from() method to count calls to the notes table
      let notesQueryCount = 0;
      const originalFrom = client.from.bind(client);
      const fromSpy = vi.spyOn(client, "from");
      fromSpy.mockImplementation((...args) => {
        const table = args[0];
        if (table === "notes") {
          notesQueryCount++;
        }
        return originalFrom(...args);
      });

      try {
        await store.listTasksByCohort(cohortId);
        expect(notesQueryCount).toBe(2);
      } finally {
        fromSpy.mockRestore();
      }
    },
    120_000,
  );
});
