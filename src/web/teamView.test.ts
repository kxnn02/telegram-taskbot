import { describe, expect, it } from "vitest";
import { buildTeamStats, sortMembersByUsername, type TeamMemberRow } from "./teamView.js";

function member(username: string, registeredAt?: string): TeamMemberRow {
  return { username, telegramId: undefined, registeredAt };
}

describe("buildTeamStats", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  it("counts every member as the total regardless of registration", () => {
    const stats = buildTeamStats([member("a"), member("b", undefined)], now);
    expect(stats.total).toBe(2);
  });

  it("returns all zeros for an empty roster", () => {
    const stats = buildTeamStats([], now);
    expect(stats).toEqual({ total: 0, newThisWeek: 0, newThisMonth: 0 });
  });

  it("excludes members who have never registered from both new-member counts", () => {
    const stats = buildTeamStats([member("a", undefined)], now);
    expect(stats.newThisWeek).toBe(0);
    expect(stats.newThisMonth).toBe(0);
  });

  it("counts a member registered exactly at the 7-day boundary as new this week", () => {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const stats = buildTeamStats([member("a", sevenDaysAgo.toISOString())], now);
    expect(stats.newThisWeek).toBe(1);
  });

  it("excludes a member registered more than 7 days ago from new-this-week", () => {
    const eightDaysAgo = new Date(now);
    eightDaysAgo.setUTCDate(now.getUTCDate() - 8);
    const stats = buildTeamStats([member("a", eightDaysAgo.toISOString())], now);
    expect(stats.newThisWeek).toBe(0);
  });

  it("counts a member registered earlier this month as new this month", () => {
    const stats = buildTeamStats([member("a", "2026-09-01T00:00:00.000Z")], now);
    expect(stats.newThisMonth).toBe(1);
  });

  it("excludes a member registered last month from new-this-month", () => {
    const stats = buildTeamStats([member("a", "2026-08-31T23:59:59.000Z")], now);
    expect(stats.newThisMonth).toBe(0);
  });

  it("counts a member registered this week toward both stats", () => {
    const stats = buildTeamStats([member("a", "2026-09-05T00:00:00.000Z")], now);
    expect(stats.newThisWeek).toBe(1);
    expect(stats.newThisMonth).toBe(1);
  });
});

describe("sortMembersByUsername", () => {
  it("sorts members alphabetically by username, case-insensitively", () => {
    const sorted = sortMembersByUsername([member("Zed"), member("alice"), member("Bob")]);
    expect(sorted.map((m) => m.username)).toEqual(["alice", "Bob", "Zed"]);
  });

  it("does not mutate the input array", () => {
    const input = [member("b"), member("a")];
    sortMembersByUsername(input);
    expect(input.map((m) => m.username)).toEqual(["b", "a"]);
  });

  it("returns an empty array unchanged", () => {
    expect(sortMembersByUsername([])).toEqual([]);
  });
});
