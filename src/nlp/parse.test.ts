import { describe, expect, it } from "vitest";
import {
  appendDescription,
  cleanTaskTitle,
  cleanupDeadlineStrippedText,
  extractDueDate,
  foldContextNotes,
  inferPriority,
  maskUrls,
  parseBulkTasks,
  parseBulkTasksHeuristic,
  parseBulkUpdates,
  parseJsonArrayFromModel,
  parseMessage,
  parseStatus,
  pickAssigneeFromText,
  sanitizeBulkTask,
  sanitizeBulkTaskWithContext,
} from "./parse.js";
import { FakeTextModel, ThrowingTextModel } from "./textModel.js";
import type { BulkTask } from "./types.js";

// Monday, 2026-08-31, 10:00 Asia/Manila (02:00 UTC) — same fixed reference
// date convention as addTaskParse.test.ts.
const REFERENCE = new Date("2026-08-31T02:00:00.000Z");

describe("pickAssigneeFromText", () => {
  it("returns the last mention, lowercased", () => {
    expect(pickAssigneeFromText("@Dale please help @Kien")).toBe("kien");
  });

  it("skips bot mentions, falling back to the last real mention", () => {
    expect(pickAssigneeFromText("@dale fix this @DevieTheBot")).toBe("dale");
  });

  it("returns null with no mentions", () => {
    expect(pickAssigneeFromText("no mentions here")).toBeNull();
  });

  it("falls back to the last bot mention when every mention is a bot mention", () => {
    expect(pickAssigneeFromText("@bot @deviebot")).toBe("deviebot");
  });
});

describe("appendDescription", () => {
  it("returns extra verbatim when base is empty", () => {
    expect(appendDescription(null, "extra")).toBe("extra");
    expect(appendDescription(undefined, "extra")).toBe("extra");
    expect(appendDescription("", "extra")).toBe("extra");
  });

  it("joins base and extra with a newline", () => {
    expect(appendDescription("base", "extra")).toBe("base\nextra");
  });
});

describe("foldContextNotes", () => {
  function task(overrides: Partial<BulkTask> & { _isContextNote?: boolean }) {
    return {
      assignee: "dale",
      title: "title",
      description: null,
      priority: "medium" as const,
      dueDate: null,
      ...overrides,
    };
  }

  it("uses the note's description over its title when both exist", () => {
    const result = foldContextNotes([
      task({ title: "Summarize the deck" }),
      task({ title: "Note:", description: "Standby on-site.", _isContextNote: true }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe("Standby on-site.");
  });

  it("does not fold into a different assignee's task", () => {
    const result = foldContextNotes([
      task({ assignee: "dale", title: "Summarize the deck" }),
      task({ assignee: "kien", title: "Note: fyi", _isContextNote: true }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("keeps a leading context note as its own task when nothing precedes it", () => {
    const result = foldContextNotes([task({ title: "Note: fyi", _isContextNote: true })]);
    expect(result).toHaveLength(1);
  });

  it("strips the internal _isContextNote flag from every returned task", () => {
    const result = foldContextNotes([task({ title: "A task" })]);
    expect(result[0]).not.toHaveProperty("_isContextNote");
  });
});

describe("parseJsonArrayFromModel", () => {
  it("parses a clean JSON array", () => {
    expect(parseJsonArrayFromModel('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("parses JSON wrapped in a markdown fence", () => {
    expect(parseJsonArrayFromModel('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it("parses JSON with prose before and after", () => {
    expect(parseJsonArrayFromModel('Here you go:\n[{"a":1}]\nHope that helps!')).toEqual([
      { a: 1 },
    ]);
  });

  it("returns null for malformed input rather than throwing", () => {
    expect(parseJsonArrayFromModel("not json at all")).toBeNull();
    expect(() => parseJsonArrayFromModel("not json at all")).not.toThrow();
  });

  it("returns null for a JSON object (not an array)", () => {
    expect(parseJsonArrayFromModel('{"a":1}')).toBeNull();
  });
});

describe("inferPriority", () => {
  it.each([
    ["urgent", "urgent"],
    ["ASAP please", "urgent"],
    ["this is critical", "urgent"],
    ["p0 fire", "urgent"],
    ["p1 issue", "urgent"],
    ["high priority task", "high"],
    ["this is important", "high"],
    ["priority 1 item", "high"],
    ["low priority chore", "low"],
    ["do this whenever", "low"],
    ["nice to have", "low"],
    ["just a normal task", "medium"],
  ] as const)("%s -> %s", (text, expected) => {
    expect(inferPriority(text)).toBe(expected);
  });
});

describe("sanitizeBulkTask", () => {
  it("rejects a missing title", () => {
    expect(sanitizeBulkTask({ assignee: "dale" }, null)).toBeNull();
  });

  it("uses the fallback assignee when none is present", () => {
    const result = sanitizeBulkTask({ title: "Fix it" }, "dale");
    expect(result?.assignee).toBe("dale");
  });

  it("rejects when neither assignee nor fallback is present", () => {
    expect(sanitizeBulkTask({ title: "Fix it" }, null)).toBeNull();
  });

  it("drops unknown fields and keeps only the known shape", () => {
    const result = sanitizeBulkTask(
      { title: "Fix it", assignee: "dale", extra: "nope" },
      null,
    );
    expect(result).toEqual({
      assignee: "dale",
      title: "Fix it",
      description: null,
      priority: "medium",
      dueDate: null,
    });
  });

  it("rejects wrong types (non-string title)", () => {
    expect(sanitizeBulkTask({ title: 123 }, "dale")).toBeNull();
  });

  it("falls back to inferred priority when priority is invalid", () => {
    const result = sanitizeBulkTask({ title: "urgent fix", assignee: "dale", priority: "nope" }, null);
    expect(result?.priority).toBe("urgent");
  });

  it("rejects a dueDate that isn't YYYY-MM-DD", () => {
    const result = sanitizeBulkTask({ title: "Fix it", assignee: "dale", dueDate: "next friday" }, null);
    expect(result?.dueDate).toBeNull();
  });
});

describe("sanitizeBulkTaskWithContext", () => {
  it("flags a Note: title as a context note", () => {
    const result = sanitizeBulkTaskWithContext({ title: "Note: standby", assignee: "dale" }, null);
    expect(result?._isContextNote).toBe(true);
  });

  it("flags an FYI: title as a context note", () => {
    const result = sanitizeBulkTaskWithContext({ title: "FYI: heads up", assignee: "dale" }, null);
    expect(result?._isContextNote).toBe(true);
  });

  it("does not flag an ordinary task", () => {
    const result = sanitizeBulkTaskWithContext({ title: "Fix login", assignee: "dale" }, null);
    expect(result?._isContextNote).toBeUndefined();
  });
});

describe("maskUrls", () => {
  it("replaces a URL with same-length filler, preserving positions", () => {
    const text = "See https://example.com/4-23 for details";
    const masked = maskUrls(text);
    expect(masked).toHaveLength(text.length);
    expect(masked).not.toMatch(/https?:\/\//);
    expect(masked.slice(0, 4)).toBe("See ");
    expect(masked.endsWith(" for details")).toBe(true);
  });

  it("leaves text with no URL untouched", () => {
    expect(maskUrls("no links here")).toBe("no links here");
  });
});

describe("cleanupDeadlineStrippedText", () => {
  it("strips a dangling trailing preposition", () => {
    expect(cleanupDeadlineStrippedText("prepare ppt for ")).toBe("prepare ppt");
  });

  it("collapses doubled-up whitespace", () => {
    expect(cleanupDeadlineStrippedText("fix   the   bug")).toBe("fix the bug");
  });

  it("removes a stray space before punctuation", () => {
    expect(cleanupDeadlineStrippedText("fix the bug ,  ship it")).toBe("fix the bug, ship it");
  });
});

describe("extractDueDate", () => {
  it("by Friday", () => {
    const result = extractDueDate("Fix the login page by Friday", REFERENCE);
    expect(result.dueDate).toBe("2026-09-04");
    expect(result.cleanText).toBe("Fix the login page");
  });

  it("tomorrow", () => {
    const result = extractDueDate("Deploy the fix tomorrow", REFERENCE);
    expect(result.dueDate).toBe("2026-09-01");
    expect(result.cleanText).toBe("Deploy the fix");
  });

  it("next week", () => {
    const result = extractDueDate("Ship it next week", REFERENCE);
    expect(result.dueDate).toBe("2026-09-07");
    expect(result.cleanText).toBe("Ship it");
  });

  it("Sept 12", () => {
    const result = extractDueDate("Meeting on Sept 12", REFERENCE);
    expect(result.dueDate).toBe("2026-09-12");
  });

  it("12/9", () => {
    const result = extractDueDate("Due 12/9", REFERENCE);
    expect(result.dueDate).toBe("2026-12-09");
  });

  it("no deadline present leaves text and date untouched", () => {
    const result = extractDueDate("Review the process used by the onboarding team", REFERENCE);
    expect(result.dueDate).toBeNull();
    expect(result.cleanText).toBe("Review the process used by the onboarding team");
  });

  it("never mistakes a date-like substring inside a URL for a deadline", () => {
    const result = extractDueDate(
      "Check the doc at https://example.com/2026-09-05/report no deadline mentioned here",
      REFERENCE,
    );
    expect(result.dueDate).toBeNull();
    expect(result.cleanText).toBe(
      "Check the doc at https://example.com/2026-09-05/report no deadline mentioned here",
    );
  });

  it("extracts a real deadline from text that also contains a URL with a date-like substring", () => {
    const result = extractDueDate(
      "See https://docs.google.com/doc/4/23 for details by Friday",
      REFERENCE,
    );
    expect(result.dueDate).toBe("2026-09-04");
    expect(result.cleanText).toBe("See https://docs.google.com/doc/4/23 for details");
  });

  it("does not fire on an unrelated word like 'now'", () => {
    const result = extractDueDate("urgent asap fix now", REFERENCE);
    expect(result.dueDate).toBeNull();
  });
});

describe("cleanTaskTitle", () => {
  it("strips both a deadline phrase and a priority word", () => {
    const result = cleanTaskTitle("urgent: fix the login page by tomorrow", REFERENCE);
    expect(result.title).toBe("fix the login page");
    expect(result.priority).toBe("urgent");
    expect(result.dueDate).toBe("2026-09-01");
  });

  it("falls back to medium priority and no due date on plain text", () => {
    const result = cleanTaskTitle("write the onboarding doc", REFERENCE);
    expect(result.title).toBe("write the onboarding doc");
    expect(result.priority).toBe("medium");
    expect(result.dueDate).toBeNull();
  });
});

describe("parseBulkTasksHeuristic", () => {
  it("splits a single @mention with multiple paragraphs into separate tasks", () => {
    const message = `@Dale
Summarize recommendations into slides.

Action Plan: Present these tomorrow.

Note: Standby on-site.`;
    const result = parseBulkTasksHeuristic(message, REFERENCE);
    expect(result).toHaveLength(2);
    expect(result[0]!.assignee).toBe("dale");
    expect(result[0]!.title).toBe("Summarize recommendations into slides");
    expect(result[1]!.title).toBe("Present these");
    expect(result[1]!.dueDate).toBe("2026-09-01");
    expect(result[1]!.description).toBe("Standby on-site");
  });

  it("infers priority per task from its own text", () => {
    const result = parseBulkTasksHeuristic("@dale this is urgent, fix the login bug", REFERENCE);
    expect(result[0]!.priority).toBe("urgent");
  });
});

describe("parseBulkTasks", () => {
  it("degrades to the heuristic path when the model throws", async () => {
    const message = "@dale fix the login bug by tomorrow";
    const result = await parseBulkTasks(message, new ThrowingTextModel(), REFERENCE);
    expect(result).toEqual(parseBulkTasksHeuristic(message, REFERENCE));
  });

  it("degrades to the heuristic path when the model returns garbage", async () => {
    const message = "@dale fix the login bug by tomorrow";
    const model = new FakeTextModel(["not json at all"]);
    const result = await parseBulkTasks(message, model, REFERENCE);
    expect(result).toEqual(parseBulkTasksHeuristic(message, REFERENCE));
  });

  it("grounds the model's due date against the heuristic when task counts agree", async () => {
    const message = "@dale fix the login bug by tomorrow";
    const model = new FakeTextModel([
      JSON.stringify([
        { assignee: "dale", title: "Fix the login bug", priority: "medium", dueDate: "2099-01-01" },
      ]),
    ]);
    const result = await parseBulkTasks(message, model, REFERENCE);
    expect(result).toHaveLength(1);
    expect(result[0]!.dueDate).toBe("2026-09-01");
  });

  it("folds a model-returned Note: paragraph into the preceding task", async () => {
    const message = "@dale summarize the deck. standby on-site.";
    const model = new FakeTextModel([
      JSON.stringify([
        { assignee: "dale", title: "Summarize the deck", priority: "medium", dueDate: null },
        { assignee: "dale", title: "Note: standby on-site", priority: "medium", dueDate: null },
      ]),
    ]);
    const result = await parseBulkTasks(message, model, REFERENCE);
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe("standby on-site");
  });
});

describe("parseBulkUpdates", () => {
  it("parses structured status pairs", async () => {
    const model = new FakeTextModel([
      JSON.stringify([
        { taskRef: "login bug", status: "done" },
        { taskRef: "docs", status: "in_review" },
      ]),
    ]);
    const result = await parseBulkUpdates("done: login bug, docs -> in review", model);
    expect(result).toEqual([
      { taskRef: "login bug", status: "done" },
      { taskRef: "docs", status: "in_review" },
    ]);
  });

  it("drops an item with a hallucinated status not in our enum", async () => {
    const model = new FakeTextModel([
      JSON.stringify([{ taskRef: "login bug", status: "cancelled" }]),
    ]);
    const result = await parseBulkUpdates("login bug is cancelled", model);
    expect(result).toEqual([]);
  });

  it("returns an empty array when the model throws", async () => {
    const result = await parseBulkUpdates("done: login bug", new ThrowingTextModel());
    expect(result).toEqual([]);
  });

  it("returns an empty array on a non-JSON response", async () => {
    const model = new FakeTextModel(["not json"]);
    const result = await parseBulkUpdates("done: login bug", model);
    expect(result).toEqual([]);
  });
});

describe("parseStatus", () => {
  it("returns the matched status", async () => {
    const model = new FakeTextModel(["in_progress"]);
    expect(await parseStatus("started working on it", model)).toBe("in_progress");
  });

  it("returns null on an unrecognised value", async () => {
    const model = new FakeTextModel(["null"]);
    expect(await parseStatus("what's up", model)).toBeNull();
  });

  it("returns null when the model throws", async () => {
    expect(await parseStatus("anything", new ThrowingTextModel())).toBeNull();
  });
});

describe("parseMessage", () => {
  it("routes an addtask intent", async () => {
    const model = new FakeTextModel([
      JSON.stringify({
        intent: "addtask",
        title: "Fix the login bug",
        priority: "high",
        assignedTo: "dale",
        dueDate: "2026-09-04",
      }),
    ]);
    const result = await parseMessage("assign dale to fix the login bug by Friday, high priority", model, {
      recentTasks: [],
    }, REFERENCE);
    expect(result).toEqual({
      intent: "addtask",
      title: "Fix the login bug",
      priority: "high",
      assignedTo: "dale",
      dueDate: "2026-09-04",
    });
  });

  it("routes an update intent referencing a task by number from context", async () => {
    const model = new FakeTextModel([JSON.stringify({ intent: "update", taskId: 23, status: "done" })]);
    const result = await parseMessage(
      "task 23 is done",
      model,
      { recentTasks: [{ id: 23, title: "Fix login bug", status: "in_progress" }] },
      REFERENCE,
    );
    expect(result).toEqual({ intent: "update", taskId: 23, status: "done" });
  });

  it("degrades to unknown on a non-JSON response", async () => {
    const model = new FakeTextModel(["not json"]);
    const result = await parseMessage("huh?", model, { recentTasks: [] }, REFERENCE);
    expect(result.intent).toBe("unknown");
  });

  it("degrades to unknown when the model throws", async () => {
    const result = await parseMessage("huh?", new ThrowingTextModel(), { recentTasks: [] }, REFERENCE);
    expect(result.intent).toBe("unknown");
  });
});
