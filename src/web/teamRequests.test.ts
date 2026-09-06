import { describe, expect, it } from "vitest";
import { parseAddMemberRequest, parseRenameMemberRequest } from "./teamRequests.js";

describe("parseAddMemberRequest", () => {
  it("accepts a body with a non-empty username", () => {
    const result = parseAddMemberRequest({ username: "alice" });
    expect(result).toEqual({ ok: true, value: { username: "alice" } });
  });

  it("rejects a non-object body", () => {
    expect(parseAddMemberRequest("nope")).toEqual({
      ok: false,
      error: "Request body must be a JSON object.",
    });
  });

  it("rejects a missing username", () => {
    expect(parseAddMemberRequest({})).toEqual({
      ok: false,
      error: `"username" is required and must be a non-empty string.`,
    });
  });

  it("rejects a blank username", () => {
    expect(parseAddMemberRequest({ username: "   " })).toEqual({
      ok: false,
      error: `"username" is required and must be a non-empty string.`,
    });
  });

  it("rejects a non-string username", () => {
    expect(parseAddMemberRequest({ username: 123 })).toEqual({
      ok: false,
      error: `"username" is required and must be a non-empty string.`,
    });
  });
});

describe("parseRenameMemberRequest", () => {
  it("accepts a body with a non-empty new username", () => {
    const result = parseRenameMemberRequest({ username: "alice2" });
    expect(result).toEqual({ ok: true, value: { username: "alice2" } });
  });

  it("rejects a non-object body", () => {
    expect(parseRenameMemberRequest(null)).toEqual({
      ok: false,
      error: "Request body must be a JSON object.",
    });
  });

  it("rejects a missing username", () => {
    expect(parseRenameMemberRequest({})).toEqual({
      ok: false,
      error: `"username" is required and must be a non-empty string.`,
    });
  });
});
