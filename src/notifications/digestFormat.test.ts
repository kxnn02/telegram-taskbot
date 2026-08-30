import { describe, expect, it } from "vitest";
import { formatGroupDailySummary, type InternDailyCounts } from "./digestFormat.js";

describe("formatGroupDailySummary", () => {
  it("shows aggregate counts across all interns", () => {
    const counts: InternDailyCounts[] = [
      { username: "alice", onTrack: 2, overdue: 1, blocked: 0 },
      { username: "bob", onTrack: 3, overdue: 1, blocked: 1 },
    ];
    const text = formatGroupDailySummary(counts);
    expect(text).toContain("5 on track");
    expect(text).toContain("2 overdue");
    expect(text).toContain("1 blocked");
  });

  it("includes one status line per intern", () => {
    const counts: InternDailyCounts[] = [
      { username: "alice", onTrack: 2, overdue: 1, blocked: 0 },
      { username: "bob", onTrack: 1, overdue: 0, blocked: 0 },
    ];
    const text = formatGroupDailySummary(counts);
    expect(text).toContain("@alice");
    expect(text).toContain("@bob");
  });

  it("never includes any task title, description, or note text", () => {
    // A malicious/careless caller might try to sneak task-shaped data through
    // extra fields; formatGroupDailySummary's declared input shape has no
    // room for that, but this test locks in the *output* contract too: only
    // digits, "on track"/"overdue"/"blocked" words, and @usernames appear.
    const counts: InternDailyCounts[] = [
      { username: "alice", onTrack: 1, overdue: 0, blocked: 0 },
    ];
    const text = formatGroupDailySummary(counts);
    const allowedWordPattern =
      /^[\d\s@a-zA-Z,.:()-]+$/; // usernames, counts, punctuation, plain summary words only
    expect(text).toMatch(allowedWordPattern);
    expect(text.toLowerCase()).not.toContain("onboarding");
  });

  it("suppresses a fully quiet cohort with a friendly all-clear message", () => {
    const text = formatGroupDailySummary([]);
    expect(text).toBe("Nothing to report today — the cohort has no open tasks.");
  });

  it("gives a plain on-track line for an intern with nothing overdue or blocked", () => {
    const counts: InternDailyCounts[] = [
      { username: "carla", onTrack: 3, overdue: 0, blocked: 0 },
    ];
    const text = formatGroupDailySummary(counts);
    expect(text).toContain("@carla: on track");
  });

  it("gives a 'no open tasks' line for an intern with zero tasks at all", () => {
    const counts: InternDailyCounts[] = [
      { username: "dan", onTrack: 0, overdue: 0, blocked: 0 },
    ];
    const text = formatGroupDailySummary(counts);
    expect(text).toContain("@dan: no open tasks");
  });
});
