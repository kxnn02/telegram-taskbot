import { describe, expect, it } from "vitest";
import { findMissingEnv, formatMissingEnvReport, REQUIRED_ENV } from "./requiredEnv.js";

/**
 * Built from REQUIRED_ENV itself (never a hand-typed literal) so this test
 * cannot silently drift from the manifest as entries are added or removed.
 */
function buildFullEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of REQUIRED_ENV) {
    env[entry.name] = "some-value";
  }
  return env;
}

describe("findMissingEnv", () => {
  it("returns [] when every production-required name is present with a non-empty value", () => {
    const env = buildFullEnv();
    expect(findMissingEnv(REQUIRED_ENV, "production", env)).toEqual([]);
  });

  it("returns exactly [\"GROQ_API_KEY\"] when GROQ_API_KEY is deleted (the 2026-09-07 outage)", () => {
    const env = buildFullEnv();
    delete env.GROQ_API_KEY;
    expect(findMissingEnv(REQUIRED_ENV, "production", env)).toEqual(["GROQ_API_KEY"]);
  });

  it("treats an empty string and a whitespace-only string as missing", () => {
    const emptyEnv = buildFullEnv();
    emptyEnv.GROQ_API_KEY = "";
    expect(findMissingEnv(REQUIRED_ENV, "production", emptyEnv)).toEqual(["GROQ_API_KEY"]);

    const whitespaceEnv = buildFullEnv();
    whitespaceEnv.GROQ_API_KEY = "   ";
    expect(findMissingEnv(REQUIRED_ENV, "production", whitespaceEnv)).toEqual(["GROQ_API_KEY"]);
  });

  it("scopes by environment: BACKUP_GITHUB_TOKEN is required for production but not preview", () => {
    const env = buildFullEnv();
    delete env.BACKUP_GITHUB_TOKEN;
    expect(findMissingEnv(REQUIRED_ENV, "production", env)).toContain("BACKUP_GITHUB_TOKEN");
    expect(findMissingEnv(REQUIRED_ENV, "preview", env)).not.toContain("BACKUP_GITHUB_TOKEN");
  });
});

describe("formatMissingEnvReport", () => {
  it("names the missing variable and the environment being checked", () => {
    const report = formatMissingEnvReport("production", ["GROQ_API_KEY"]);
    expect(report).toContain("GROQ_API_KEY");
    expect(report).toContain("production");
  });
});

describe("REQUIRED_ENV", () => {
  it("has a unique name and a non-empty why for every entry", () => {
    const names = REQUIRED_ENV.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);

    for (const entry of REQUIRED_ENV) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.why.trim().length).toBeGreaterThan(0);
    }
  });
});
