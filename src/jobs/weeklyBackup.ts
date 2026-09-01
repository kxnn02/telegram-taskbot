import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `/api/jobs/weekly-backup` core logic (ADR-0007): the Supabase free tier
 * has zero automatic backups, so this exports every table as JSON and
 * commits it to a private GitHub repo the maintainer already controls —
 * reusing infrastructure this project already depends on (a GitHub
 * account, `gh`/git familiarity) and getting free version history as a
 * side effect, rather than standing up a new backup service. Triggered by
 * Vercel Cron (not `pg_cron`) for the same reason as `keep-alive`: it must
 * be reachable even if Supabase itself is paused.
 *
 * A plain `fetch` call to GitHub's REST API is used instead of adding
 * `octokit` as a dependency — `package.json` has no GitHub API client
 * already, and this needs exactly one call (create-or-update file
 * contents), which plain `fetch` handles without a new dependency.
 */

/** Every table this schema currently has (`supabase/migrations/*_init_schema.sql`).
 * Includes `processed_telegram_updates` and `alert_throttle` even though
 * they're churny/low-value to restore from — completeness ("all tables",
 * per issue #15) was chosen over curating a subset, since the export is
 * cheap and a restore can simply ignore rows it doesn't need. */
export const BACKUP_TABLES = [
  "cohorts",
  "roster",
  "tasks",
  "notes",
  "overdue_notifications",
  "registrations",
  "cohort_counters",
  "processed_telegram_updates",
  "wizard_state",
  "alert_throttle",
] as const;

export async function exportAllTables(
  client: SupabaseClient,
): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const { data, error } = await client.from(table).select("*");
    if (error) {
      throw new Error(`export ${table} failed: ${error.message}`);
    }
    result[table] = data ?? [];
  }
  return result;
}

export interface CommitBackupInput {
  githubToken: string;
  /** `owner/repo` of the private backup repo. */
  githubRepo: string;
  /** Path within the repo, e.g. `backups/2026-09-01.json`. */
  path: string;
  content: string;
  message: string;
}

/**
 * Creates (or updates, if the same path already exists) one file in the
 * backup repo via GitHub's "Create or update file contents" REST endpoint.
 * `fetchImpl` is injectable so tests never make a real network call —
 * production code omits it and gets the global `fetch` (Node >=22, per
 * `package.json`'s `engines`).
 */
export async function commitBackupToGitHub(
  input: CommitBackupInput,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const [owner, repo] = input.githubRepo.split("/");
  const res = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/contents/${input.path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "telegram-taskbot-weekly-backup",
      },
      body: JSON.stringify({
        message: input.message,
        content: Buffer.from(input.content, "utf-8").toString("base64"),
      }),
    },
  );
  if (!res.ok) {
    const text = "text" in res ? await res.text().catch(() => "") : "";
    throw new Error(`GitHub backup commit failed (${res.status}): ${text}`);
  }
}

export interface RunWeeklyBackupDeps {
  client: SupabaseClient;
  githubToken: string;
  githubRepo: string;
}

/** Full weekly-backup run: export every table, then commit one dated JSON
 * file (`backups/{YYYY-MM-DD}.json`, UTC date of `now`) to the backup repo.
 * `now` and `fetchImpl` are both injectable for deterministic tests. */
export async function runWeeklyBackup(
  deps: RunWeeklyBackupDeps,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const tables = await exportAllTables(deps.client);
  const isoDate = now.toISOString().slice(0, 10);
  await commitBackupToGitHub(
    {
      githubToken: deps.githubToken,
      githubRepo: deps.githubRepo,
      path: `backups/${isoDate}.json`,
      content: JSON.stringify(tables, null, 2),
      message: `Weekly backup ${isoDate}`,
    },
    fetchImpl,
  );
}
