import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { handleJobEndpoint } from "../../src/jobs/jobEndpoint.js";
import { verifyInternalJobSecret } from "../../src/jobs/jobAuth.js";
import { loadJobEnv, buildNotificationJobDeps } from "../../src/jobs/buildJobDeps.js";
import { runOverdueCrossingJob } from "../../src/jobs/notificationJobs.js";
import { notifyJobFailure } from "../../src/jobs/notifyJobFailure.js";

/**
 * Vercel serverless function for the hourly overdue-crossing-check job
 * (ADR-0007, issue #15), triggered by `pg_cron` + `pg_net` (see
 * `supabase/migrations/*_notification_jobs_cron.sql`). Thin adapter, same
 * shape as `api/telegram/webhook.ts`: real logic lives in
 * `src/jobs/notificationJobs.ts`'s `runOverdueCrossingJob`, unit-tested
 * directly. Scoped to this deployment's single `ACTIVE_COHORT_ID` only —
 * see `notificationJobs.ts`'s doc comment for why not every roster cohort.
 */

const JOB_NAME = "overdue-crossing-check";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = loadJobEnv();
  const deps = await buildNotificationJobDeps();

  const result = await handleJobEndpoint(
    {
      verify: (headers) => verifyInternalJobSecret(headers, env.internalJobSecret),
      work: () => runOverdueCrossingJob(deps, env.activeCohortId),
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
