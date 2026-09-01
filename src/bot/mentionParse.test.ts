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

  for (const phrase of ["pls work on", "please work on", "add task", "new task", "todo"]) {
    it(`recognises the "${phrase}" phrase after a mention`, () => {
      expect(parseMentionTrigger(`@${BOT} ${phrase} fix login`, BOT)).toEqual({
        kind: "addtask",
        args: "fix login",
      });
    });
  }

  it("returns unrecognized for a mention with no recognisable intent", () => {
    expect(parseMentionTrigger(`@${BOT} how's it going`, BOT)).toEqual({ kind: "unrecognized" });
  });

  it("returns unrecognized for a mention with an intent phrase but no title", () => {
    expect(parseMentionTrigger(`@${BOT} add task`, BOT)).toEqual({ kind: "unrecognized" });
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
});
