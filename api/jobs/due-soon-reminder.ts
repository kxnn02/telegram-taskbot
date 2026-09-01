import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { handleJobEndpoint } from "../../src/jobs/jobEndpoint.js";
import { verifyInternalJobSecret } from "../../src/jobs/jobAuth.js";
import { loadJobEnv, buildNotificationJobDeps } from "../../src/jobs/buildJobDeps.js";
import { runDueSoonReminderJob } from "../../src/jobs/notificationJobs.js";
import { notifyJobFailure } from "../../src/jobs/notifyJobFailure.js";

/**
 * Vercel serverless function for the daily due-tomorrow reminder job
 * (ADR-0007, issue #15). See `overdue-crossing.ts` for the shared shape —
 * this differs only in which core job function it calls.
 */

const JOB_NAME = "due-soon-reminder";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = loadJobEnv();
  const deps = await buildNotificationJobDeps();

  const result = await handleJobEndpoint(
    {
      verify: (headers) => verifyInternalJobSecret(headers, env.internalJobSecret),
      work: () => runDueSoonReminderJob(deps, env.activeCohortId),
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
