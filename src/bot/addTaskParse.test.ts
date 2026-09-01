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

describe("parseAddTaskArgs anchors the date on an explicit 'by' (issue #49/#51, finding F2)", () => {
  it("walks 'by' occurrences last-to-first: 'fix the bug found by QA by next Friday'", () => {
    const result = ok(
      parseAddTaskArgs("fix the bug found by QA by next Friday", REFERENCE),
    );
    expect(result.title).toBe("fix the bug found by QA");
    expect(result.assigneeUsername).toBeUndefined();
    expect(result.dueDate?.isoDate).toBe("2026-09-11");
  });

  it("accepts an absolute ISO date after 'by'", () => {
    const result = ok(parseAddTaskArgs("ship it by 2026-12-01", REFERENCE));
    expect(result.title).toBe("ship it");
    expect(result.dueDate?.isoDate).toBe("2026-12-01");
  });

  it("accepts a relative date after 'by'", () => {
    const result = ok(parseAddTaskArgs("ship it by in 3 days", REFERENCE));
    expect(result.title).toBe("ship it");
    expect(result.dueDate?.isoDate).toBe("2026-09-03");
  });

  it("accepts trailing punctuation after the date", () => {
    const result = ok(parseAddTaskArgs("fix login by Sept 5.", REFERENCE));
    expect(result.title).toBe("fix login");
    expect(result.dueDate?.isoDate).toBe("2026-09-05");
  });

  it("'tomorrow' after 'by'", () => {
    const result = ok(parseAddTaskArgs("fix login by tomorrow", REFERENCE));
    expect(result.title).toBe("fix login");
    expect(result.dueDate?.isoDate).toBe("2026-09-01");
  });

  it("does not invent a date from a month name embedded in the title", () => {
    const result = ok(parseAddTaskArgs("fix bug in march module", REFERENCE));
    expect(result.title).toBe("fix bug in march module");
    expect(result.dueDate).toBeUndefined();
  });

  it("does not invent a date from a month abbreviation embedded in the title", () => {
    const result = ok(parseAddTaskArgs("review the sept deck", REFERENCE));
    expect(result.title).toBe("review the sept deck");
    expect(result.dueDate).toBeUndefined();
  });

  it("does not invent a date from a weekday abbreviation embedded in the title", () => {
    const result = ok(parseAddTaskArgs("call sat about the API", REFERENCE));
    expect(result.title).toBe("call sat about the API");
    expect(result.dueDate).toBeUndefined();
  });

  it("does not invent a date from a time-of-day phrase embedded in the title", () => {
    const result = ok(parseAddTaskArgs("deploy to prod at 5", REFERENCE));
    expect(result.title).toBe("deploy to prod at 5");
    expect(result.dueDate).toBeUndefined();
  });

  it("does not reject a title with a weekday abbreviation and no 'by'", () => {
    const result = ok(parseAddTaskArgs("sun deck redesign", REFERENCE));
    expect(result.title).toBe("sun deck redesign");
    expect(result.dueDate).toBeUndefined();
  });

  it("does not invent a date from a month name with no 'by'", () => {
    const result = ok(parseAddTaskArgs("update may report", REFERENCE));
    expect(result.title).toBe("update may report");
    expect(result.dueDate).toBeUndefined();
  });

  it("does not invent a date from a month abbreviation with no 'by'", () => {
    const result = ok(parseAddTaskArgs("check on jan's PR", REFERENCE));
    expect(result.title).toBe("check on jan's PR");
    expect(result.dueDate).toBeUndefined();
  });

  it("'by <name>' with no parseable date leaves the title whole", () => {
    const result = ok(parseAddTaskArgs("review PR by alice", REFERENCE));
    expect(result.title).toBe("review PR by alice");
    expect(result.dueDate).toBeUndefined();
  });

  it("'sorted by name' has no date after 'by'", () => {
    const result = ok(parseAddTaskArgs("sorted by name", REFERENCE));
    expect(result.title).toBe("sorted by name");
    expect(result.dueDate).toBeUndefined();
  });

  it("'refactor the code by hand' has no date after 'by'", () => {
    const result = ok(parseAddTaskArgs("refactor the code by hand", REFERENCE));
    expect(result.title).toBe("refactor the code by hand");
    expect(result.dueDate).toBeUndefined();
  });

  it("trailing words after the date defeat full-consumption and keep the whole string as the title", () => {
    const result = ok(
      parseAddTaskArgs("fix login by next Friday please", REFERENCE),
    );
    expect(result.title).toBe("fix login by next Friday please");
    expect(result.dueDate).toBeUndefined();
  });

  it("chrono can't parse 'end of week', so the whole string stays the title", () => {
    const result = ok(
      parseAddTaskArgs("write the doc by end of week", REFERENCE),
    );
    expect(result.title).toBe("write the doc by end of week");
    expect(result.dueDate).toBeUndefined();
  });
});
