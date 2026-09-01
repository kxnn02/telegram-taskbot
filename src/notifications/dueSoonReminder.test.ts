import { describe, expect, it } from "vitest";
import type { Task } from "../domain/types.js";
import { findDueTomorrow } from "./dueSoonReminder.js";

// 2026-09-04 10:00 Asia/Manila -> tomorrow (Manila) is 2026-09-05.
const NOW = new Date("2026-09-04T02:00:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    cohortId: "cohort-5",
    title: "Write the onboarding doc",
    description: "d",
    assigneeUsername: "alice",
    assignedByUsername: "carla",
    dueDate: "2026-09-05",
    status: "in_progress",
    notes: [],
    previousStatus: null,
    blockedReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("findDueTomorrow", () => {
  it("includes a still-open task due exactly tomorrow (Asia/Manila)", () => {
    const result = findDueTomorrow([task()], NOW);
    expect(result).toHaveLength(1);
  });

  it("excludes a task due today", () => {
    const result = findDueTomorrow([task({ id: 2, dueDate: "2026-09-04" })], NOW);
    expect(result).toHaveLength(0);
  });

  it("excludes a task due in two days", () => {
    const result = findDueTomorrow([task({ id: 3, dueDate: "2026-09-06" })], NOW);
    expect(result).toHaveLength(0);
  });

  it("includes a task that's already in_review — only done is excluded now", () => {
    const result = findDueTomorrow([task({ id: 4, status: "in_review" })], NOW);
    expect(result).toHaveLength(1);
  });

  it("excludes a task that's already done", () => {
    const result = findDueTomorrow([task({ id: 5, status: "done" })], NOW);
    expect(result).toHaveLength(0);
  });

  it("includes a backlog task due tomorrow", () => {
    const result = findDueTomorrow([task({ id: 6, status: "backlog" })], NOW);
    expect(result).toHaveLength(1);
  });

  it("includes a blocked task due tomorrow", () => {
    const result = findDueTomorrow([task({ id: 7, status: "blocked" })], NOW);
    expect(result).toHaveLength(1);
  });

  it("includes a todo task due tomorrow", () => {
    const result = findDueTomorrow([task({ id: 8, status: "todo" })], NOW);
    expect(result).toHaveLength(1);
  });

  it("includes a task assigned to a HigherUp — eligibility isn't role-scoped", () => {
    const result = findDueTomorrow(
      [task({ id: 9, assigneeUsername: "dave", status: "todo" })],
      NOW,
    );
    expect(result).toHaveLength(1);
  });
});
