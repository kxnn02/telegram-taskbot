import { describe, expect, it } from "vitest";
import { checkGroupMembership, type MembershipApi } from "./groupMembership.js";
import type { ChatMember } from "@grammyjs/types/manage.js";

const USER_ID = 42;
const GROUP_CHAT_ID = "-100123456789";

function fakeMembershipApi(member: ChatMember | Error): MembershipApi {
  return {
    getChatMember: async () => {
      if (member instanceof Error) throw member;
      return member;
    },
  };
}

describe("checkGroupMembership", () => {
  it("groupChatId undefined -> unavailable, 'no group configured'", async () => {
    const api = fakeMembershipApi(new Error("should not be called"));
    const result = await checkGroupMembership(api, undefined, USER_ID);
    expect(result).toEqual({ kind: "unavailable", reason: "no group configured" });
  });

  it("groupChatId null -> unavailable, 'no group configured'", async () => {
    const api = fakeMembershipApi(new Error("should not be called"));
    const result = await checkGroupMembership(api, null, USER_ID);
    expect(result).toEqual({ kind: "unavailable", reason: "no group configured" });
  });

  it("getChatMember throws -> unavailable with the error's message", async () => {
    const api = fakeMembershipApi(new Error("Telegram is down"));
    const result = await checkGroupMembership(api, GROUP_CHAT_ID, USER_ID);
    expect(result).toEqual({ kind: "unavailable", reason: "Telegram is down" });
  });

  it("status creator -> present", async () => {
    const api = fakeMembershipApi({
      status: "creator",
      user: { id: USER_ID, is_bot: false, first_name: "T" },
      is_anonymous: false,
    });
    const result = await checkGroupMembership(api, GROUP_CHAT_ID, USER_ID);
    expect(result).toEqual({ kind: "present" });
  });

  it("status administrator -> present", async () => {
    const api = fakeMembershipApi({
      status: "administrator",
      user: { id: USER_ID, is_bot: false, first_name: "T" },
    } as ChatMember);
    const result = await checkGroupMembership(api, GROUP_CHAT_ID, USER_ID);
    expect(result).toEqual({ kind: "present" });
  });

  it("status member -> present", async () => {
    const api = fakeMembershipApi({
      status: "member",
      user: { id: USER_ID, is_bot: false, first_name: "T" },
    });
    const result = await checkGroupMembership(api, GROUP_CHAT_ID, USER_ID);
    expect(result).toEqual({ kind: "present" });
  });

  it("status restricted with is_member true -> present", async () => {
    const api = fakeMembershipApi({
      status: "restricted",
      user: { id: USER_ID, is_bot: false, first_name: "T" },
      is_member: true,
    } as ChatMember);
    const result = await checkGroupMembership(api, GROUP_CHAT_ID, USER_ID);
    expect(result).toEqual({ kind: "present" });
  });

  it("status restricted with is_member false -> absent", async () => {
    const api = fakeMembershipApi({
      status: "restricted",
      user: { id: USER_ID, is_bot: false, first_name: "T" },
      is_member: false,
    } as ChatMember);
    const result = await checkGroupMembership(api, GROUP_CHAT_ID, USER_ID);
    expect(result).toEqual({ kind: "absent" });
  });

  it("status left -> absent", async () => {
    const api = fakeMembershipApi({
      status: "left",
      user: { id: USER_ID, is_bot: false, first_name: "T" },
    });
    const result = await checkGroupMembership(api, GROUP_CHAT_ID, USER_ID);
    expect(result).toEqual({ kind: "absent" });
  });

  it("status kicked -> absent", async () => {
    const api = fakeMembershipApi({
      status: "kicked",
      user: { id: USER_ID, is_bot: false, first_name: "T" },
      until_date: 0,
    });
    const result = await checkGroupMembership(api, GROUP_CHAT_ID, USER_ID);
    expect(result).toEqual({ kind: "absent" });
  });
});
