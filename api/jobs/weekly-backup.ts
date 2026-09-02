import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { handleJobEndpoint, reportConfigError } from "../../src/jobs/jobEndpoint.js";
import { verifyCronSecret } from "../../src/jobs/jobAuth.js";
import { createSupabaseClient } from "../../src/storage/supabaseClient.js";
import { runWeeklyBackup } from "../../src/jobs/weeklyBackup.js";
import { buildErrorReportingDeps, loadErrorReportingEnv } from "../../src/jobs/buildJobDeps.js";
import { notifyJobFailure } from "../../src/jobs/notifyJobFailure.js";

/**
 * Vercel serverless function for the weekly-backup job (ADR-0007, issue
 * #15): triggered by Vercel Cron (`vercel.json`'s `crons` array), same
 * platform-constraint reasoning as `keep-alive.ts`. Exports every table and
 * commits one dated JSON file to a private GitHub repo, named/authed via
 * `BACKUP_GITHUB_REPO` (`owner/repo`) and `BACKUP_GITHUB_TOKEN` env vars —
 * deliberately separate from `INTERNAL_JOB_SECRET`/`CRON_SECRET`, which
 * authenticate *incoming* requests to this endpoint, not this endpoint's
 * own outgoing call to GitHub.
 */
const JOB_NAME = "weekly-backup";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = loadErrorReportingEnv();
  const client = createSupabaseClient();
  const errorDeps = await buildErrorReportingDeps(client);
  const onError = (error: unknown) =>
    notifyJobFailure(
      {
        bot: errorDeps.bot,
        registrations: errorDeps.registrations,
        throttle: errorDeps.throttle,
        maintainerUsername: env.maintainerUsername,
      },
      JOB_NAME,
      env.activeCohortId,
      error,
    );

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    const result = await reportConfigError(onError, "CRON_SECRET is not set.");
    res.status(result.status).json(result.body ?? {});
    return;
  }
  const githubToken = process.env.BACKUP_GITHUB_TOKEN;
  if (!githubToken) {
    const result = await reportConfigError(onError, "BACKUP_GITHUB_TOKEN is not set.");
    res.status(result.status).json(result.body ?? {});
    return;
  }
  const githubRepo = process.env.BACKUP_GITHUB_REPO;
  if (!githubRepo) {
    const result = await reportConfigError(onError, "BACKUP_GITHUB_REPO is not set.");
    res.status(result.status).json(result.body ?? {});
    return;
  }

  const result = await handleJobEndpoint(
    {
      verify: (headers) => verifyCronSecret(headers, cronSecret),
      work: () => runWeeklyBackup({ client, githubToken, githubRepo }),
      onError,
    },
    {
      method: req.method,
      headers: req.headers as Record<string, string | string[] | undefined>,
    },
  );
  res.status(result.status).json(result.body ?? {});
}
