import { describe, expect, it } from "vitest";
import { Roster } from "../domain/roster.js";
import {
  NO_MEMBERS_TO_ASSIGN_REPLY,
  formatAllAssignedReply,
  formatRoleAssignedReply,
  resolveAllMembers,
  resolveRoleMembers,
} from "./fanOut.js";

const COHORT = "cohort-5";
const OTHER_COHORT = "cohort-4";

function makeRoster() {
  return new Roster([
    { username: "alice", cohortId: COHORT },
    { username: "bob", cohortId: COHORT },
    { username: "carla", cohortId: COHORT },
    { username: "dave", cohortId: OTHER_COHORT },
  ]);
}

describe("resolveAllMembers (issue #104 — @all fan-out, route.ts:1202-1210 @ 632a22c)", () => {
  it("returns every roster member in the given cohort", () => {
    const usernames = resolveAllMembers(makeRoster(), COHORT).sort();
    expect(usernames).toEqual(["alice", "bob", "carla"]);
  });

  it("never returns a member from a different cohort", () => {
    const usernames = resolveAllMembers(makeRoster(), COHORT);
    expect(usernames).not.toContain("dave");
  });

  it("returns an empty list for a cohort with no members", () => {
    expect(resolveAllMembers(makeRoster(), "cohort-empty")).toEqual([]);
  });
});

// Devie's `resolveRoleMembers` (`route.ts:475-484` @ `632a22c`) matches a
// member's `role` field case-insensitively. Issue #103 item 2 already maps
// Devie's `role` onto this repo's `cohort_id` (every member's "role" is the
// cohort they belong to) — so this ports the same fan-out onto `cohortId`.
describe("resolveRoleMembers (issue #104 — role mapped onto cohort_id)", () => {
  it("returns every member whose cohortId matches the slug, case-insensitively", () => {
    const usernames = resolveRoleMembers(makeRoster(), "COHORT-5").sort();
    expect(usernames).toEqual(["alice", "bob", "carla"]);
  });

  it("returns an empty list when the slug matches no cohort", () => {
    expect(resolveRoleMembers(makeRoster(), "nonexistent-cohort")).toEqual([]);
  });
});

// Devie's `@all` confirmation reply (`route.ts:1226-1232` @ `632a22c`),
// wording and emoji copied verbatim.
describe("formatAllAssignedReply", () => {
  it("uses singular wording and lists each assigned member", () => {
    const reply = formatAllAssignedReply(["alice"], "Fix the login page");
    expect(reply).toContain("✅ Task assigned to all <b>1</b> member");
    expect(reply).not.toContain("members");
    expect(reply).toContain("Fix the login page");
    expect(reply).toContain("• @alice");
  });

  it("uses plural wording for more than one member", () => {
    const reply = formatAllAssignedReply(["alice", "bob"], "Fix the login page");
    expect(reply).toContain("✅ Task assigned to all <b>2</b> members");
    expect(reply).toContain("• @alice");
    expect(reply).toContain("• @bob");
  });
});

describe("NO_MEMBERS_TO_ASSIGN_REPLY", () => {
  it("matches Devie's wording (route.ts:1207-1209)", () => {
    expect(NO_MEMBERS_TO_ASSIGN_REPLY).toBe("❌ No members found to assign to.");
  });
});

// Devie's role/cohort fan-out confirmation (`route.ts:1262-1266`).
describe("formatRoleAssignedReply", () => {
  it("names the role slug and the first created task's ref", () => {
    const reply = formatRoleAssignedReply(["alice", "bob"], "Fix the login page", "cohort-5", 7);
    expect(reply).toContain("✅ Task assigned to <b>2</b> members in <b>cohort-5</b>");
    expect(reply).toContain("T-007");
    expect(reply).toContain("• @alice");
    expect(reply).toContain("• @bob");
  });

  it("uses singular wording for exactly one member", () => {
    const reply = formatRoleAssignedReply(["alice"], "Fix the login page", "cohort-5", 7);
    expect(reply).toContain("✅ Task assigned to <b>1</b> member in <b>cohort-5</b>");
  });
});
