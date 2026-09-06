import { describe, expect, it } from "vitest";
import { parseSaveSettingsRequest } from "./settingsRequests.js";

describe("parseSaveSettingsRequest", () => {
  it("accepts a groupChatId string", () => {
    const result = parseSaveSettingsRequest({ groupChatId: "-1001234567890" });
    expect(result).toEqual({ ok: true, value: { groupChatId: "-1001234567890" } });
  });

  it("accepts an empty string as 'clear the group chat id'", () => {
    const result = parseSaveSettingsRequest({ groupChatId: "" });
    expect(result).toEqual({ ok: true, value: { groupChatId: "" } });
  });

  it("rejects a missing groupChatId field", () => {
    const result = parseSaveSettingsRequest({});
    expect(result.ok).toBe(false);
  });

  it("rejects a non-string groupChatId", () => {
    const result = parseSaveSettingsRequest({ groupChatId: 12345 });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseSaveSettingsRequest(null).ok).toBe(false);
    expect(parseSaveSettingsRequest("nope").ok).toBe(false);
    expect(parseSaveSettingsRequest([]).ok).toBe(false);
  });
});
