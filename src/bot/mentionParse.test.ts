import { describe, expect, it } from "vitest";
import { parseMentionTrigger } from "./mentionParse.js";

const BOT = "test_bot";

describe("parseMentionTrigger", () => {
  it("returns none when there is no mention at all", () => {
    expect(parseMentionTrigger("pls work on fix login", BOT)).toEqual({ kind: "none" });
  });

  it("does nothing for ordinary chatter containing 'add task' but no mention", () => {
    expect(parseMentionTrigger("someone should add task the login bug", BOT)).toEqual({
      kind: "none",
    });
  });

  for (const phrase of ["pls work on", "please work on", "add task", "new task"]) {
    it(`recognises the "${phrase}" phrase after a mention`, () => {
      expect(parseMentionTrigger(`@${BOT} ${phrase} fix login`, BOT)).toEqual({
        kind: "addtask",
        args: "fix login",
      });
    });
  }

  it("returns usage for a mention with an intent phrase but no title", () => {
    expect(parseMentionTrigger(`@${BOT} add task`, BOT)).toEqual({ kind: "usage" });
  });

  it("finds the mention inside a longer sentence", () => {
    expect(
      parseMentionTrigger(`hey team, @${BOT} pls work on the login bug`, BOT),
    ).toEqual({ kind: "addtask", args: "the login bug" });
  });

  it("carries an assignment and date through to args for parseAddTaskArgs to split", () => {
    expect(
      parseMentionTrigger(`@${BOT} add task fix login by Friday @jean`, BOT),
    ).toEqual({ kind: "addtask", args: "fix login by Friday @jean" });
  });

  it("is case-insensitive on both the mention and the phrase", () => {
    expect(parseMentionTrigger(`@${BOT.toUpperCase()} ADD TASK fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });

  it("does not match a mention that is a prefix of another username", () => {
    expect(parseMentionTrigger(`@${BOT}_helper add task fix login`, BOT)).toEqual({
      kind: "none",
    });
  });

  it("still returns addtask for an embedded mention followed by an intent phrase", () => {
    expect(parseMentionTrigger(`hey @${BOT} pls work on fix the login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix the login",
    });
  });
});

// Issue #103's delta table, one test per row: the phrase set is widened to
// DevieBot's exact lead-in regex (`route.ts:726`) — see MENTION_LEAD_IN_RE in
// mentionParse.ts for the copy of it. Each `it` below names the row it pins,
// so a later widening/narrowing of the matcher can't drift from Devie
// silently.
describe("parseMentionTrigger — issue #103 delta table vs. issue #34's five phrases", () => {
  it("ADD: 'work on ...' with no politeness prefix", () => {
    expect(parseMentionTrigger(`@${BOT} work on fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });

  it("ADD: a 'can you ...' prefix", () => {
    expect(parseMentionTrigger(`@${BOT} can you work on fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });

  it("ADD: a 'could you ...' prefix", () => {
    expect(parseMentionTrigger(`@${BOT} could you add task fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });

  it("ADD: 'create task ...'", () => {
    expect(parseMentionTrigger(`@${BOT} create task fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });

  it("ADD: a bare 'add ...'", () => {
    expect(parseMentionTrigger(`@${BOT} add fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });

  it("REMOVE: 'todo ...' is no longer an intent phrase — Devie does not accept it, so this is silence", () => {
    expect(parseMentionTrigger(`@${BOT} todo fix login`, BOT)).toEqual({ kind: "none" });
  });

  it("ADD: the trailing-colon form 'add task: fix login' (Devie's own worked example)", () => {
    expect(parseMentionTrigger(`@${BOT} add task: fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });

  it("ADD: politeness prefixes repeat — 'pls can you work on ...'", () => {
    expect(parseMentionTrigger(`@${BOT} pls can you work on fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });

  it("CHANGE: a leading mention with no phrase match is silent, not a 'did you mean' nudge", () => {
    expect(parseMentionTrigger(`@${BOT} how's it going`, BOT)).toEqual({ kind: "none" });
  });

  it("CHANGE: a passing mention like 'thanks @bot' stays silent (unchanged from #34, pinned here)", () => {
    expect(parseMentionTrigger(`thanks @${BOT} !`, BOT)).toEqual({ kind: "none" });
  });

  it("copies Devie's un-word-bounded 'add' wart: 'adding' matches 'add' and leaves 'ing ...' as the title", () => {
    // Devie's regex has no \b after the phrase alternation, so "adding the
    // login form" is read as "add" + "ing the login form". Carbon-copied on
    // purpose (issue #103 rule 2) — an improvement is proposed separately.
    expect(parseMentionTrigger(`@${BOT} adding the login form`, BOT)).toEqual({
      kind: "addtask",
      args: "ing the login form",
    });
  });

  it("collapses runs of whitespace inside the phrase, as Devie does before matching", () => {
    expect(parseMentionTrigger(`@${BOT} pls    work   on   fix login`, BOT)).toEqual({
      kind: "addtask",
      args: "fix login",
    });
  });
});
