import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "../service/taskService.js";
import {
  buildTasksPage,
  fetchTaskPages,
  parseTasksCallback,
  parseTasksFilter,
  type TaskPage,
} from "./tasksPage.js";

const COHORT = "cohort-5";
const NOW = new Date("2026-09-01T02:00:00.000Z"); // Tuesday

const carla: Caller = { username: "carla", cohortId: COHORT };

function makeService(entries = [{ username: "carla", cohortId: COHORT }]) {
  const store = new InMemoryTaskStore();
  const roster = new Roster(entries);
  return { service: new TaskService(store, roster, new FixedClock(NOW)), roster, store };
}

/** A hand-built page, so `buildTasksPage` can be exercised as the pure
 * function it is — no service, no store. */
function page(name: string, byStatus: Record<string, string[]> = {}): TaskPage {
  return { name, role: COHORT, byStatus };
}

function navRow(keyboard: { inline_keyboard: { text: string; callback_data: string }[][] }) {
  return keyboard.inline_keyboard[1];
}

function filterRow(keyboard: { inline_keyboard: { text: string; callback_data: string }[][] }) {
  return keyboard.inline_keyboard[0];
}

describe("buildTasksPage — paging (issue #103 item 1)", () => {
  const pages = [
    page("alice", { todo: ["  • <code>T-001</code> Write the docs"] }),
    page("bob", { in_progress: ["  • <code>T-002</code> Fix the login bug"] }),
    page("carla", { blocked: ["  • <code>T-003</code> Wait on design"] }),
  ];

  it("the first page wraps Prev around to the last page and points Next at the second", () => {
    const { text, keyboard } = buildTasksPage(pages, 0, "all", [COHORT]);
    expect(text).toContain("👤 <b>@alice</b>");
    expect(text).toContain("<i>(1 / 3)</i>");
    expect(navRow(keyboard)).toEqual([
      { text: "◀ Prev", callback_data: "tasks|all|2" },
      { text: "1 / 3", callback_data: "tasks|all|0" },
      { text: "Next ▶", callback_data: "tasks|all|1" },
    ]);
  });

  it("a middle page points Prev and Next at its neighbours", () => {
    const { text, keyboard } = buildTasksPage(pages, 1, "all", [COHORT]);
    expect(text).toContain("👤 <b>@bob</b>");
    expect(text).toContain("<i>(2 / 3)</i>");
    expect(navRow(keyboard)).toEqual([
      { text: "◀ Prev", callback_data: "tasks|all|0" },
      { text: "2 / 3", callback_data: "tasks|all|1" },
      { text: "Next ▶", callback_data: "tasks|all|2" },
    ]);
  });

  it("the last page wraps Next around to the first page", () => {
    const { text, keyboard } = buildTasksPage(pages, 2, "all", [COHORT]);
    expect(text).toContain("👤 <b>@carla</b>");
    expect(text).toContain("<i>(3 / 3)</i>");
    expect(navRow(keyboard)).toEqual([
      { text: "◀ Prev", callback_data: "tasks|all|1" },
      { text: "3 / 3", callback_data: "tasks|all|2" },
      { text: "Next ▶", callback_data: "tasks|all|0" },
    ]);
  });

  it("a single page gets no nav row at all — only the filter row", () => {
    const { text, keyboard } = buildTasksPage([pages[0]!], 0, "all", [COHORT]);
    expect(text).toContain("<i>(1 / 1)</i>");
    expect(keyboard.inline_keyboard).toHaveLength(1);
    expect(navRow(keyboard)).toBeUndefined();
  });

  it("clamps an out-of-range page onto the nearest real one", () => {
    expect(buildTasksPage(pages, 99, "all", [COHORT]).text).toContain("👤 <b>@carla</b>");
    expect(buildTasksPage(pages, -5, "all", [COHORT]).text).toContain("👤 <b>@alice</b>");
  });

  it("carries the active role filter into every nav callback", () => {
    const { keyboard } = buildTasksPage(pages, 1, COHORT, [COHORT]);
    expect(navRow(keyboard)!.map((b) => b.callback_data)).toEqual([
      `tasks|${COHORT}|0`,
      `tasks|${COHORT}|1`,
      `tasks|${COHORT}|2`,
    ]);
  });
});

describe("buildTasksPage — the filter row (issue #103 items 1 and 2)", () => {
  it("offers All plus every known role, marking the active one with a leading dot", () => {
    const { keyboard } = buildTasksPage([page("alice")], 0, "all", [COHORT, "cohort-6"]);
    expect(filterRow(keyboard)).toEqual([
      { text: "· All", callback_data: "tasks|all|0" },
      { text: COHORT, callback_data: `tasks|${COHORT}|0` },
      { text: "cohort-6", callback_data: "tasks|cohort-6|0" },
    ]);
  });

  it("moves the dot onto the active role filter", () => {
    const { keyboard } = buildTasksPage([page("alice")], 0, COHORT, [COHORT, "cohort-6"]);
    expect(filterRow(keyboard)).toEqual([
      { text: "All", callback_data: "tasks|all|0" },
      { text: `· ${COHORT}`, callback_data: `tasks|${COHORT}|0` },
      { text: "cohort-6", callback_data: "tasks|cohort-6|0" },
    ]);
  });

  it("every filter button always resets to page 0", () => {
    const { keyboard } = buildTasksPage(
      [page("alice"), page("bob")],
      1,
      "all",
      [COHORT, "cohort-6"],
    );
    for (const button of filterRow(keyboard)!) {
      expect(button.callback_data).toMatch(/\|0$/);
    }
  });
});

describe("buildTasksPage — empty and no-task cases", () => {
  it("no pages at all gets Devie's no-active-tasks text and only a filter row", () => {
    const { text, keyboard } = buildTasksPage([], 0, "all", [COHORT]);
    expect(text).toBe("📋 <b>Tasks</b>\n\n<i>No active tasks for this filter.</i>");
    expect(keyboard.inline_keyboard).toHaveLength(1);
  });

  it("names the active role filter in the empty text", () => {
    const { text } = buildTasksPage([], 0, COHORT, [COHORT]);
    expect(text).toBe(
      `📋 <b>Tasks — ${COHORT}</b>\n\n<i>No active tasks for this filter.</i>`,
    );
  });

  it("a member whose page holds no tasks still renders, with Devie's per-page empty line", () => {
    const { text } = buildTasksPage([page("alice")], 0, "all", [COHORT]);
    expect(text).toContain("👤 <b>@alice</b>");
    expect(text).toContain("<i>No active tasks.</i>");
  });
});

describe("buildTasksPage — status sections", () => {
  it("renders sections in Devie's blocked/in progress/in review/todo/backlog order", () => {
    const { text } = buildTasksPage(
      [
        page("alice", {
          backlog: ["  • <code>T-005</code> Later"],
          todo: ["  • <code>T-004</code> Soon"],
          in_review: ["  • <code>T-003</code> Review me"],
          in_progress: ["  • <code>T-002</code> Doing"],
          blocked: ["  • <code>T-001</code> Stuck"],
        }),
      ],
      0,
      "all",
      [COHORT],
    );
    const order = ["🚧 <i>Blocked</i>", "🔄 <i>In Progress</i>", "👀 <i>In Review</i>", "📝 <i>To Do</i>", "📦 <i>Backlog</i>"];
    const positions = order.map((heading) => text.indexOf(heading));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("skips a status with no lines", () => {
    const { text } = buildTasksPage(
      [page("alice", { todo: ["  • <code>T-001</code> Only one"] })],
      0,
      "all",
      [COHORT],
    );
    expect(text).toContain("📝 <i>To Do</i>");
    expect(text).not.toContain("📦 <i>Backlog</i>");
    expect(text).not.toContain("<i>No active tasks.</i>");
  });

  it("never renders a Done section — Devie's list is non-done only", () => {
    const { text } = buildTasksPage(
      [page("alice", { done: ["  • <code>T-001</code> Finished"] })],
      0,
      "all",
      [COHORT],
    );
    expect(text).not.toContain("Done");
    expect(text).toContain("<i>No active tasks.</i>");
  });
});

describe("buildTasksPage — long lists", () => {
  it("a long roster splits across pages, one member per page", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      page(`member${String(i).padStart(2, "0")}`, {
        todo: [`  • <code>T-0${i}</code> Task ${i}`],
      }),
    );
    const { text, keyboard } = buildTasksPage(many, 12, "all", [COHORT]);
    expect(text).toContain("<i>(13 / 25)</i>");
    expect(navRow(keyboard)).toEqual([
      { text: "◀ Prev", callback_data: "tasks|all|11" },
      { text: "13 / 25", callback_data: "tasks|all|12" },
      { text: "Next ▶", callback_data: "tasks|all|13" },
    ]);
  });

  it("one member's very long list is NOT chunked — Devie pages by member, never by message length", () => {
    // Carbon-copied limitation (#103 rule 2): the page is delivered with
    // editMessageText, which cannot be split across messages the way
    // `chunkMessage` splits a plain reply, and Devie does not try. A member
    // holding this many tasks would push the message past Telegram's 4096
    // characters and the edit would fail. Pinned here so the gap is visible
    // rather than discovered in the group chat.
    const lines = Array.from(
      { length: 120 },
      (_, i) => `  • <code>T-${String(i).padStart(3, "0")}</code> A fairly long task title number ${i}`,
    );
    const { text } = buildTasksPage([page("alice", { todo: lines })], 0, "all", [COHORT]);
    expect(text.split("\n").filter((l) => l.startsWith("  • "))).toHaveLength(120);
    expect(text.length).toBeGreaterThan(4096);
  });
});

describe("parseTasksFilter (issue #103 item 2)", () => {
  it("a bare /tasks filters nothing", () => {
    expect(parseTasksFilter("")).toEqual({ roleFilter: "all", assigneeFilter: null });
    expect(parseTasksFilter("   ")).toEqual({ roleFilter: "all", assigneeFilter: null });
  });

  it("/tasks @name filters by member and leaves the role filter at all", () => {
    expect(parseTasksFilter("@Alice")).toEqual({ roleFilter: "all", assigneeFilter: "alice" });
  });

  it("takes the first @mention when several are given, as Devie does", () => {
    expect(parseTasksFilter("@alice @bob")).toEqual({
      roleFilter: "all",
      assigneeFilter: "alice",
    });
  });

  it("/tasks <role> maps the whole remainder onto a role filter, lowercased", () => {
    expect(parseTasksFilter("Cohort-5")).toEqual({
      roleFilter: "cohort-5",
      assigneeFilter: null,
    });
  });

  it("keeps a multi-word role filter whole", () => {
    expect(parseTasksFilter("design team")).toEqual({
      roleFilter: "design team",
      assigneeFilter: null,
    });
  });
});

describe("parseTasksCallback", () => {
  it("parses a role and a page out of the callback payload", () => {
    expect(parseTasksCallback("tasks|all|3")).toEqual({ roleFilter: "all", page: 3 });
    expect(parseTasksCallback(`tasks|${COHORT}|0`)).toEqual({ roleFilter: COHORT, page: 0 });
  });

  it("rejects a payload that is not a tasks callback", () => {
    expect(parseTasksCallback("standup|active|0")).toBeUndefined();
    expect(parseTasksCallback("")).toBeUndefined();
  });

  it("rejects a non-numeric page", () => {
    expect(parseTasksCallback("tasks|all|x")).toBeUndefined();
  });
});

describe("fetchTaskPages (issue #103 items 1 and 2)", () => {
  async function seed(
    service: TaskService,
    assignee: string,
    title: string,
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "blocked" | "done",
    priority?: "low" | "medium" | "high" | "urgent",
  ) {
    const created = await service.assignTask(carla, {
      assigneeUsername: assignee,
      title,
      dueDate: "2026-09-05",
      priority,
    });
    if (!created.ok) throw new Error("setup failed: " + created.error);
    if (status && status !== "todo") await service.setStatus(carla, created.value.id, status);
    return created.value.id;
  }

  it("builds one page per member, ordered by role then name", async () => {
    const { service, roster } = makeService([
      { username: "carla", cohortId: COHORT },
      { username: "alice", cohortId: COHORT },
      { username: "bob", cohortId: COHORT },
    ]);
    await seed(service, "bob", "Bob's task");
    await seed(service, "alice", "Alice's task");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: null,
    });
    expect(pages.map((p) => p.name)).toEqual(["alice", "bob"]);
    expect(pages.every((p) => p.role === COHORT)).toBe(true);
  });

  it("leaves out done tasks, and so leaves out a member who has only done tasks", async () => {
    const { service, roster } = makeService([
      { username: "carla", cohortId: COHORT },
      { username: "alice", cohortId: COHORT },
    ]);
    await seed(service, "alice", "Finished", "done");
    await seed(service, "carla", "Still going", "in_progress");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: null,
    });
    expect(pages.map((p) => p.name)).toEqual(["carla"]);
  });

  it("groups a member's tasks by status and renders Devie's task line", async () => {
    const { service, roster } = makeService();
    const id = await seed(service, "carla", "Fix the login bug", "in_progress", "urgent");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: null,
    });
    expect(pages[0]!.byStatus.in_progress).toEqual([
      `  • <code>T-${String(id).padStart(3, "0")}</code> Fix the login bug`,
    ]);
  });

  it("escapes HTML in a task title", async () => {
    const { service, roster } = makeService();
    await seed(service, "carla", "Fix <b>bold</b> & co");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: null,
    });
    expect(pages[0]!.byStatus.todo![0]).toContain("Fix &lt;b&gt;bold&lt;/b&gt; &amp; co");
  });

  it("hangs the latest link and the latest note off the task line", async () => {
    const { service, roster } = makeService();
    const id = await seed(service, "carla", "Fix the login bug");
    await service.addNote(carla, id, "https://example.com/pr/1");
    await service.addNote(carla, id, "ready for QA");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: null,
    });
    const line = pages[0]!.byStatus.todo![0]!;
    expect(line).toContain('· <a href="https://example.com/pr/1">🔗</a>');
    expect(line).toContain("\n    📝 ready for QA");
  });

  it("filters to one member with an assignee filter", async () => {
    const { service, roster } = makeService([
      { username: "carla", cohortId: COHORT },
      { username: "alice", cohortId: COHORT },
    ]);
    await seed(service, "alice", "Alice's task");
    await seed(service, "carla", "Carla's task");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: "alice",
    });
    expect(pages.map((p) => p.name)).toEqual(["alice"]);
  });

  it("a role filter naming the caller's cohort keeps every page", async () => {
    const { service, roster } = makeService();
    await seed(service, "carla", "Carla's task");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: COHORT,
      assigneeFilter: null,
    });
    expect(pages.map((p) => p.name)).toEqual(["carla"]);
  });

  it("a role filter naming any other cohort matches nothing", async () => {
    const { service, roster } = makeService();
    await seed(service, "carla", "Carla's task");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "cohort-9",
      assigneeFilter: null,
    });
    expect(pages).toEqual([]);
  });

  it("offers only the caller's own cohort as a role, never another cohort's id", async () => {
    const { service, roster } = makeService([
      { username: "carla", cohortId: COHORT },
      { username: "other", cohortId: "cohort-9" },
    ]);
    await seed(service, "carla", "Carla's task");

    const { allRoles } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: null,
    });
    expect(allRoles).toEqual([COHORT]);
  });

  it("cohort isolation: another cohort's tasks never reach a page", async () => {
    const { service, roster } = makeService([
      { username: "carla", cohortId: COHORT },
      { username: "other", cohortId: "cohort-9" },
    ]);
    await service.assignTask(
      { username: "other", cohortId: "cohort-9" },
      { assigneeUsername: "other", title: "Secret task", dueDate: "2026-09-05" },
    );
    await seed(service, "carla", "Carla's task");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: null,
    });
    expect(pages.map((p) => p.name)).toEqual(["carla"]);
    expect(JSON.stringify(pages)).not.toContain("Secret task");
  });

  it("orders a member's lines urgent first, then high, medium and low", async () => {
    const { service, roster } = makeService();
    await seed(service, "carla", "Low one", "todo", "low");
    await seed(service, "carla", "Urgent one", "todo", "urgent");
    await seed(service, "carla", "Medium one", "todo", "medium");
    await seed(service, "carla", "High one", "todo", "high");

    const { pages } = await fetchTaskPages(service, carla, roster, {
      roleFilter: "all",
      assigneeFilter: null,
    });
    const titles = pages[0]!.byStatus.todo!.map((l) => l.replace(/^.*<\/code> /, ""));
    expect(titles).toEqual(["Urgent one", "High one", "Medium one", "Low one"]);
  });
});
