import { describe, expect, it, vi } from "vitest";
import { BACKUP_TABLES, commitBackupToGitHub, exportAllTables, runWeeklyBackup } from "./weeklyBackup.js";

function fakeSupabaseClient(rows: Record<string, unknown[]>) {
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockResolvedValue({ data: rows[table] ?? [], error: null }),
  }));
  return { from } as any;
}

describe("exportAllTables", () => {
  it("reads every table in BACKUP_TABLES into one object keyed by table name", async () => {
    const client = fakeSupabaseClient({ cohorts: [{ cohort_id: "cohort-5" }], tasks: [] });

    const result = await exportAllTables(client);

    for (const table of BACKUP_TABLES) {
      expect(result).toHaveProperty(table);
    }
    expect(result.cohorts).toEqual([{ cohort_id: "cohort-5" }]);
  });

  it("throws if a table read fails", async () => {
    const from = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    }));
    const client = { from } as any;

    await expect(exportAllTables(client)).rejects.toThrow(/boom/);
  });
});

describe("commitBackupToGitHub", () => {
  it("PUTs base64-encoded content to the GitHub contents API with the auth token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 });

    await commitBackupToGitHub(
      {
        githubToken: "gh-token",
        githubRepo: "kxnn02/backups-private",
        path: "backups/2026-09-01.json",
        content: '{"a":1}',
        message: "Weekly backup 2026-09-01",
      },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://api.github.com/repos/kxnn02/backups-private/contents/backups/2026-09-01.json",
    );
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer gh-token");
    const body = JSON.parse(init.body);
    expect(body.message).toBe("Weekly backup 2026-09-01");
    expect(Buffer.from(body.content, "base64").toString("utf-8")).toBe('{"a":1}');
  });

  it("throws with the response body when GitHub returns a non-ok status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve("Invalid request"),
    });

    await expect(
      commitBackupToGitHub(
        {
          githubToken: "gh-token",
          githubRepo: "kxnn02/backups-private",
          path: "backups/2026-09-01.json",
          content: "{}",
          message: "msg",
        },
        fetchImpl,
      ),
    ).rejects.toThrow(/422/);
  });
});

describe("runWeeklyBackup", () => {
  it("exports every table and commits one JSON file dated by the given now", async () => {
    const client = fakeSupabaseClient({ cohorts: [{ cohort_id: "cohort-5" }] });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 });

    await runWeeklyBackup(
      { client, githubToken: "gh-token", githubRepo: "kxnn02/backups-private" },
      new Date("2026-09-01T04:00:00Z"),
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://api.github.com/repos/kxnn02/backups-private/contents/backups/2026-09-01.json",
    );
    const body = JSON.parse(init.body);
    const decoded = JSON.parse(Buffer.from(body.content, "base64").toString("utf-8"));
    expect(decoded.cohorts).toEqual([{ cohort_id: "cohort-5" }]);
  });
});
