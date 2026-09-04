import { describe, expect, it } from "vitest";
import { findMigrationDrift, formatDriftReport, parseMigrationList } from "./migrationDrift.js";

const PURE_JSON_STDOUT = JSON.stringify({
  migrations: [{ local: "20260902010000", remote: "20260902010000", time: "2026-09-02 01:00:00" }],
  message: "Migrations listed",
});

describe("parseMigrationList", () => {
  it("parses a pure-JSON stdout into entries", () => {
    expect(parseMigrationList(PURE_JSON_STDOUT)).toEqual([
      { local: "20260902010000", remote: "20260902010000", time: "2026-09-02 01:00:00" },
    ]);
  });

  it("parses stdout that has a progress line before the JSON", () => {
    const stdout = `Connecting to remote database...\n${PURE_JSON_STDOUT}`;
    expect(parseMigrationList(stdout)).toEqual([
      { local: "20260902010000", remote: "20260902010000", time: "2026-09-02 01:00:00" },
    ]);
  });

  it("throws on empty stdout", () => {
    expect(() => parseMigrationList("")).toThrow();
  });

  it("throws on non-JSON stdout, with the raw text in the message", () => {
    const stdout = "Connecting to remote database...\nsomething went wrong, not JSON at all";
    expect(() => parseMigrationList(stdout)).toThrow(/something went wrong, not JSON at all/);
  });
});

describe("findMigrationDrift", () => {
  it("returns both arrays empty when every entry has matching local and remote", () => {
    const drift = findMigrationDrift([
      { local: "1", remote: "1", time: "t" },
      { local: "2", remote: "2", time: "t" },
    ]);
    expect(drift).toEqual({ unapplied: [], untracked: [] });
  });

  it("reports an entry with an empty remote as unapplied", () => {
    const drift = findMigrationDrift([{ local: "29991231000000", remote: "", time: "2999-12-31 00:00:00" }]);
    expect(drift).toEqual({ unapplied: ["29991231000000"], untracked: [] });
  });

  it("reports an entry with an empty local as untracked", () => {
    const drift = findMigrationDrift([{ local: "", remote: "20260101000000", time: "t" }]);
    expect(drift).toEqual({ unapplied: [], untracked: ["20260101000000"] });
  });

  it("handles both kinds present at once", () => {
    const drift = findMigrationDrift([
      { local: "1", remote: "1", time: "t" },
      { local: "2", remote: "", time: "t" },
      { local: "", remote: "3", time: "t" },
    ]);
    expect(drift).toEqual({ unapplied: ["2"], untracked: ["3"] });
  });
});

describe("formatDriftReport", () => {
  it("names the offending version and contains the remediation command", () => {
    const report = formatDriftReport({ unapplied: ["29991231000000"], untracked: [] });
    expect(report).toContain("29991231000000");
    expect(report).toContain("supabase db push");
  });
});
