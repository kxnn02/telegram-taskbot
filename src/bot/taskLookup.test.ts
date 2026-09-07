import { describe, expect, it } from "vitest";
import { findTaskByRef } from "./taskLookup.js";
import type { Task } from "../domain/types.js";

function makeTask(overrides: Partial<Task> & { id: number }): Task {
  return {
    cohortId: "cohort-5",
    title: "untitled",
    assigneeUsername: "alice",
    assignedByUsername: "bob",
    dueDate: "2026-09-10",
    status: "todo",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    priority: "medium",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    orderIndex: 0,
    ...overrides,
  } as Task;
}

describe("findTaskByRef (issue #124 stage S1)", () => {
  const fixture: Task[] = [
    makeTask({ id: 21, title: "Fix login bug", createdAt: "2026-09-01T00:00:00.000Z" }),
    makeTask({ id: 22, title: "Login page redesign", createdAt: "2026-09-03T00:00:00.000Z" }),
    makeTask({ id: 23, title: "Update docs", createdAt: "2026-09-02T00:00:00.000Z" }),
    makeTask({
      id: 24,
      title: "Login bug retest",
      status: "done",
      createdAt: "2026-09-04T00:00:00.000Z",
    }),
  ];

  it("resolves a numeric ref to the matching task", () => {
    expect(findTaskByRef(fixture, "23")).toEqual({ kind: "found", task: fixture[2] });
  });

  it("resolves a t-prefixed and T- prefixed ref", () => {
    expect(findTaskByRef(fixture, "t23")).toEqual({ kind: "found", task: fixture[2] });
    expect(findTaskByRef(fixture, "T-023")).toEqual({ kind: "found", task: fixture[2] });
  });

  it("a numeric miss is 'none' — never falls through to a keyword search", () => {
    // "999" would match nothing by id, and nothing by title substring either,
    // but the point is it must not even attempt the keyword search.
    expect(findTaskByRef(fixture, "999")).toEqual({ kind: "none" });
  });

  it("matches by case-insensitive title substring", () => {
    expect(findTaskByRef(fixture, "UPDATE DOCS")).toEqual({ kind: "found", task: fixture[2] });
  });

  it("excludes done tasks from the keyword search", () => {
    // "login bug" matches #21 ("Fix login bug") and would match #24 ("Login
    // bug retest") too, but #24 is done, so only #21 survives — an
    // unambiguous single match, not ambiguous.
    expect(findTaskByRef(fixture, "login bug")).toEqual({ kind: "found", task: fixture[0] });
  });

  it("exactly one surviving match resolves to 'found'", () => {
    expect(findTaskByRef(fixture, "docs")).toEqual({ kind: "found", task: fixture[2] });
  });

  it("two or more surviving matches are 'ambiguous', sorted newest-first", () => {
    // "login" matches #21 and #22 (not #24 — done, excluded).
    expect(findTaskByRef(fixture, "login")).toEqual({
      kind: "ambiguous",
      matches: [fixture[1], fixture[0]],
    });
  });

  it("caps ambiguous matches at 5, newest first", () => {
    const many: Task[] = Array.from({ length: 7 }, (_, i) =>
      makeTask({
        id: 100 + i,
        title: "shared keyword",
        createdAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const result = findTaskByRef(many, "shared keyword");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(result.matches).toHaveLength(5);
    expect(result.matches.map((t) => t.id)).toEqual([106, 105, 104, 103, 102]);
  });

  it("empty or whitespace-only input is 'none'", () => {
    expect(findTaskByRef(fixture, "")).toEqual({ kind: "none" });
    expect(findTaskByRef(fixture, "   ")).toEqual({ kind: "none" });
  });

  it("no match at all is 'none'", () => {
    expect(findTaskByRef(fixture, "nonexistent keyword")).toEqual({ kind: "none" });
  });
});
