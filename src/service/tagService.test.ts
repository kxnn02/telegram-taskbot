import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { InMemoryTagStore } from "../storage/inMemoryTagStore.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { TagService } from "./tagService.js";
import { TaskService } from "./taskService.js";

const COHORT = "cohort-5";
const OTHER_COHORT = "cohort-4";

function makeRoster() {
  return new Roster([
    { username: "alice", cohortId: COHORT },
    { username: "bob", cohortId: COHORT },
    { username: "erin", cohortId: OTHER_COHORT },
  ]);
}

function caller(username: string, cohortId = COHORT): Caller {
  return { username, cohortId };
}

const alice = caller("alice");
const otherCaller = caller("erin", OTHER_COHORT);

const NOW = new Date("2026-08-31T02:00:00.000Z");

function makeServices() {
  const taskStore = new InMemoryTaskStore();
  const tagStore = new InMemoryTagStore();
  const taskService = new TaskService(taskStore, makeRoster(), new FixedClock(NOW));
  const tagService = new TagService(tagStore, taskService);
  return { taskService, tagService, taskStore, tagStore };
}

describe("TagService.createTag", () => {
  it("defaults color to #6366f1 when omitted (decision 3)", async () => {
    const { tagService } = makeServices();
    const result = await tagService.createTag(alice, "Backend");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.color).toBe("#6366f1");
  });

  it("uses the given color when provided", async () => {
    const { tagService } = makeServices();
    const result = await tagService.createTag(alice, "Backend", "#ef4444");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.color).toBe("#ef4444");
  });

  it("rejects an empty name", async () => {
    const { tagService } = makeServices();
    const result = await tagService.createTag(alice, "   ");
    expect(result.ok).toBe(false);
  });

  it("scopes the created tag to the caller's cohort", async () => {
    const { tagService } = makeServices();
    const result = await tagService.createTag(alice, "Backend");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cohortId).toBe(COHORT);
  });
});

describe("TagService.listTags", () => {
  it("lists only the caller's cohort's tags", async () => {
    const { tagService } = makeServices();
    await tagService.createTag(alice, "Backend");
    await tagService.createTag(otherCaller, "Frontend");

    const result = await tagService.listTags(alice);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((t) => t.name)).toEqual(["Backend"]);
  });
});

describe("TagService.setTaskTags / listTasksWithTags", () => {
  let ctx: ReturnType<typeof makeServices>;
  let taskId: number;

  beforeEach(async () => {
    ctx = makeServices();
    const created = await ctx.taskService.assignTask(alice, {
      assigneeUsername: "alice",
      title: "Ship the board",
      dueDate: "2026-09-05",
    });
    if (!created.ok) throw new Error("setup failed");
    taskId = created.value.id;
  });

  it("attaches tags to a task and reflects them in listTasksWithTags", async () => {
    const tagA = await ctx.tagService.createTag(alice, "A");
    const tagB = await ctx.tagService.createTag(alice, "B");
    if (!tagA.ok || !tagB.ok) throw new Error("setup failed");

    const setResult = await ctx.tagService.setTaskTags(alice, taskId, [tagA.value.id, tagB.value.id]);
    expect(setResult.ok).toBe(true);

    const listed = await ctx.tagService.listTasksWithTags(alice);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const task = listed.value.find((t) => t.id === taskId);
      expect(task?.tags.map((t) => t.name).sort()).toEqual(["A", "B"]);
    }
  });

  it("a task with no tags gets an empty tags array", async () => {
    const listed = await ctx.tagService.listTasksWithTags(alice);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const task = listed.value.find((t) => t.id === taskId);
      expect(task?.tags).toEqual([]);
    }
  });

  it("setTaskTags rejects a task that doesn't exist in the caller's cohort", async () => {
    const result = await ctx.tagService.setTaskTags(otherCaller, taskId, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't exist/i);
  });

  it("setTaskTags replaces the full set rather than merging", async () => {
    const tagA = await ctx.tagService.createTag(alice, "A");
    const tagB = await ctx.tagService.createTag(alice, "B");
    if (!tagA.ok || !tagB.ok) throw new Error("setup failed");

    await ctx.tagService.setTaskTags(alice, taskId, [tagA.value.id, tagB.value.id]);
    await ctx.tagService.setTaskTags(alice, taskId, [tagA.value.id]);

    const listed = await ctx.tagService.listTasksWithTags(alice);
    if (listed.ok) {
      const task = listed.value.find((t) => t.id === taskId);
      expect(task?.tags.map((t) => t.name)).toEqual(["A"]);
    }
  });
});
