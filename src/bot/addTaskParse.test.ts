import { describe, expect, it } from "vitest";
import { parseAddTaskArgs, type AddTaskParsed } from "./addTaskParse.js";

// Monday, 2026-08-31, 10:00 Asia/Manila (02:00 UTC).
const REFERENCE = new Date("2026-08-31T02:00:00.000Z");

function ok(result: ReturnType<typeof parseAddTaskArgs>): AddTaskParsed {
  if ("error" in result) throw new Error("expected a parsed result, got: " + result.error);
  return result;
}

describe("parseAddTaskArgs", () => {
  it("title only", () => {
    const result = ok(parseAddTaskArgs("Fix the login page", REFERENCE));
    expect(result.title).toBe("Fix the login page");
    expect(result.assigneeUsername).toBeUndefined();
    expect(result.dueDate).toBeUndefined();
  });

  it("title + date", () => {
    const result = ok(parseAddTaskArgs("Fix the login page by next Friday", REFERENCE));
    expect(result.title).toBe("Fix the login page");
    expect(result.assigneeUsername).toBeUndefined();
    expect(result.dueDate?.isoDate).toBe("2026-09-11");
  });

  it("title + assignee", () => {
    const result = ok(parseAddTaskArgs("Fix the login page @jean", REFERENCE));
    expect(result.title).toBe("Fix the login page");
    expect(result.assigneeUsername).toBe("jean");
    expect(result.dueDate).toBeUndefined();
  });

  it("title + date + assignee, date first", () => {
    const result = ok(
      parseAddTaskArgs("fix the login by Friday @jean", REFERENCE),
    );
    expect(result.title).toBe("fix the login");
    expect(result.assigneeUsername).toBe("jean");
    expect(result.dueDate?.isoDate).toBe("2026-09-04");
  });

  it("title + date + assignee, assignee first", () => {
    const result = ok(
      parseAddTaskArgs("fix the login @jean by Friday", REFERENCE),
    );
    expect(result.title).toBe("fix the login");
    expect(result.assigneeUsername).toBe("jean");
    expect(result.dueDate?.isoDate).toBe("2026-09-04");
  });

  it("a title that legitimately contains the word 'by' stays whole when there's no date clause", () => {
    const result = ok(
      parseAddTaskArgs("Review the process used by the onboarding team", REFERENCE),
    );
    expect(result.title).toBe("Review the process used by the onboarding team");
    expect(result.dueDate).toBeUndefined();
  });

  it("rejects an empty title after stripping a bare mention", () => {
    const result = parseAddTaskArgs("@jean", REFERENCE);
    expect("error" in result).toBe(true);
  });

  it("rejects blank input", () => {
    const result = parseAddTaskArgs("   ", REFERENCE);
    expect("error" in result).toBe(true);
  });
});
