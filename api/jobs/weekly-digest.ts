import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { handleJobEndpoint } from "../../src/jobs/jobEndpoint.js";
import { verifyInternalJobSecret } from "../../src/jobs/jobAuth.js";
import { loadJobEnv, buildNotificationJobDeps } from "../../src/jobs/buildJobDeps.js";
import { runWeeklyDigestJob } from "../../src/jobs/notificationJobs.js";
import { notifyJobFailure } from "../../src/jobs/notifyJobFailure.js";

/**
 * Vercel serverless function for the weekly (Monday) digest job (ADR-0007,
 * issue #15). See `daily-digest.ts` for the shared shape.
 */

const JOB_NAME = "weekly-digest";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = loadJobEnv();
  const deps = await buildNotificationJobDeps();

  const result = await handleJobEndpoint(
    {
      verify: (headers) => verifyInternalJobSecret(headers, env.internalJobSecret),
      work: () => runWeeklyDigestJob(deps, env.activeCohortId),
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
