import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { handleJobEndpoint } from "../../src/jobs/jobEndpoint.js";
import { verifyInternalJobSecret } from "../../src/jobs/jobAuth.js";
import { loadJobEnv, buildRosterReconciliationDeps } from "../../src/jobs/buildJobDeps.js";
import { runRosterReconciliationJob } from "../../src/jobs/rosterReconciliation.js";
import { notifyJobFailure } from "../../src/jobs/notifyJobFailure.js";

/**
 * Vercel serverless function for the daily roster-reconciliation job
 * (ticket R5/#90), triggered by `pg_cron` + `pg_net` (see
 * `supabase/migrations/*_roster_reconciliation_cron.sql`). Thin adapter,
 * same shape as the other `api/jobs/*.ts` endpoints: real logic lives in
 * `src/jobs/rosterReconciliation.ts`'s `runRosterReconciliationJob`,
 * unit-tested directly. A thrown error — including the deliberate "abort
 * this cohort" throw when group membership is unavailable — is caught by
 * `handleJobEndpoint` and reported once via `notifyJobFailure`, same as
 * every other job. Scoped to this deployment's single `ACTIVE_COHORT_ID`
 * only — see `notificationJobs.ts`'s doc comment for why not every roster
 * cohort.
 */

const JOB_NAME = "roster-reconciliation";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = loadJobEnv();
  const deps = await buildRosterReconciliationDeps();

  const result = await handleJobEndpoint(
    {
      verify: (headers) => verifyInternalJobSecret(headers, env.internalJobSecret),
      work: () => runRosterReconciliationJob(deps, env.activeCohortId),
      onError: (error) =>
        notifyJobFailure(
          {
            bot: deps.bot,
            registrations: deps.registrations,
            throttle: deps.throttle,
            maintainerUsername: env.maintainerUsername,
          },
          JOB_NAME,
          env.activeCohortId,
          error,
        ),
    },
    {
      method: req.method,
      headers: req.headers as Record<string, string | string[] | undefined>,
    },
  );
  res.status(result.status).json(result.body ?? {});
}
