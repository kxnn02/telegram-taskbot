import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./schema.js";
import { OverdueNotificationRepository } from "./overdueNotificationRepository.js";

describe("OverdueNotificationRepository", () => {
  let repo: OverdueNotificationRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new OverdueNotificationRepository(db);
  });

  it("reports a task as not yet notified before it's marked", () => {
    expect(repo.hasNotified("cohort-5", 1)).toBe(false);
  });

  it("reports a task as notified once marked", () => {
    repo.markNotified("cohort-5", 1);
    expect(repo.hasNotified("cohort-5", 1)).toBe(true);
  });

  it("scopes notified state per cohort, not globally by task id", () => {
    repo.markNotified("cohort-5", 1);
    expect(repo.hasNotified("cohort-4", 1)).toBe(false);
  });

  it("marking the same task notified twice doesn't throw", () => {
    repo.markNotified("cohort-5", 7);
    expect(() => repo.markNotified("cohort-5", 7)).not.toThrow();
    expect(repo.hasNotified("cohort-5", 7)).toBe(true);
  });
});
