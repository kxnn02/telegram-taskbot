import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { guardSetup, handleJobEndpoint, reportConfigError } from "../../src/jobs/jobEndpoint.js";
import { verifyCronSecret } from "../../src/jobs/jobAuth.js";
import { createSupabaseClient } from "../../src/storage/supabaseClient.js";
import { pingDatabase } from "../../src/jobs/keepAlive.js";
import {
  buildErrorReportingDeps,
  loadErrorReportingEnv,
  makeSetupReporter,
} from "../../src/jobs/buildJobDeps.js";
import { notifyJobFailure } from "../../src/jobs/notifyJobFailure.js";

/**
 * Vercel serverless function for the keep-alive job (ADR-0007, issue #15):
 * triggered by Vercel Cron (`vercel.json`'s `crons` array), not `pg_cron` —
 * it exists specifically to keep Supabase's free-tier project from
 * auto-pausing, so it can't depend on Supabase's own scheduler to run it.
 *
 * Authenticated via `CRON_SECRET` + Vercel's own
 * `Authorization: Bearer $CRON_SECRET` convention (see `jobAuth.ts`'s
 * `verifyCronSecret` doc comment for why this differs from the
 * `pg_net`-triggered jobs' custom header).
 *
 * The dependency construction below sits inside `guardSetup` (issue #43)
 * because every line of it can throw on missing config, and until `onError`
 * exists there is nothing to report such a throw with — which is how this
 * endpoint stayed broken and silent for months.
 */
const JOB_NAME = "keep-alive";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await guardSetup(
    JOB_NAME,
    makeSetupReporter(),
    async () => {
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
      return { client, onError };
    },
    async ({ client, onError }) => {
      const cronSecret = process.env.CRON_SECRET;
      if (!cronSecret) {
        return reportConfigError(onError, "CRON_SECRET is not set.");
      }
      return handleJobEndpoint(
        {
          verify: (headers) => verifyCronSecret(headers, cronSecret),
          work: () => pingDatabase(client),
          onError,
        },
        {
          method: req.method,
          headers: req.headers as Record<string, string | string[] | undefined>,
        },
      );
    },
  );
  res.status(result.status).json(result.body ?? {});
}
