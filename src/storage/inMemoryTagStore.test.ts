import { describe, expect, it } from "vitest";
import { InMemoryTagStore } from "./inMemoryTagStore.js";

/**
 * Plain unit tests for `InMemoryTagStore` (no shared `TagStorePort` contract
 * file — unlike `TaskStorePort`, there's no live Supabase connection
 * available in this sandboxed worktree to run a real `SupabaseTagStore`
 * against the same suite, so a shared contract file would only ever get one
 * implementation exercised through it; see the sub-stage 5b PR body).
 */
describe("InMemoryTagStore", () => {
  it("creates a tag and lists it back, ordered by name", async () => {
    const store = new InMemoryTagStore();
    await store.createTag("cohort-5", "Backend", "#3b82f6");
    await store.createTag("cohort-5", "Alpha", "#ef4444");

    const tags = await store.listTagsByCohort("cohort-5");
    expect(tags.map((t) => t.name)).toEqual(["Alpha", "Backend"]);
    expect(tags[0]?.cohortId).toBe("cohort-5");
  });

  it("scopes listTagsByCohort by cohort", async () => {
    const store = new InMemoryTagStore();
    await store.createTag("cohort-5", "Only in 5", "#3b82f6");
    await store.createTag("cohort-4", "Only in 4", "#ef4444");

    expect((await store.listTagsByCohort("cohort-5")).map((t) => t.name)).toEqual(["Only in 5"]);
    expect((await store.listTagsByCohort("cohort-4")).map((t) => t.name)).toEqual(["Only in 4"]);
  });

  it("setTaskTags replaces the full set for a task (replace-all semantics)", async () => {
    const store = new InMemoryTagStore();
    const a = await store.createTag("cohort-5", "A", "#111111");
    const b = await store.createTag("cohort-5", "B", "#222222");
    const c = await store.createTag("cohort-5", "C", "#333333");

    await store.setTaskTags("cohort-5", 1, [a.id, b.id]);
    let map = await store.listTaskTagIdsByCohort("cohort-5");
    expect(map.get(1)).toEqual([a.id, b.id].sort((x, y) => x - y));

    // Replace-all: setting again with a different set drops the old one
    // entirely rather than merging (matches Devie's task-dialog save flow).
    await store.setTaskTags("cohort-5", 1, [c.id]);
    map = await store.listTaskTagIdsByCohort("cohort-5");
    expect(map.get(1)).toEqual([c.id]);
  });

  it("setTaskTags with an empty array clears a task's tags", async () => {
    const store = new InMemoryTagStore();
    const a = await store.createTag("cohort-5", "A", "#111111");
    await store.setTaskTags("cohort-5", 1, [a.id]);
    await store.setTaskTags("cohort-5", 1, []);

    const map = await store.listTaskTagIdsByCohort("cohort-5");
    expect(map.get(1)).toEqual([]);
  });

  it("listTaskTagIdsByCohort scopes by cohort and covers every tagged task", async () => {
    const store = new InMemoryTagStore();
    const a = await store.createTag("cohort-5", "A", "#111111");
    await store.setTaskTags("cohort-5", 1, [a.id]);
    await store.setTaskTags("cohort-5", 2, [a.id]);
    await store.setTaskTags("cohort-4", 1, [a.id]);

    const map = await store.listTaskTagIdsByCohort("cohort-5");
    expect([...map.keys()].sort()).toEqual([1, 2]);
  });
});
