import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { verifyInternalJobSecret } from "../../src/jobs/jobAuth.js";
import { loadJobEnv, buildNotificationJobDeps } from "../../src/jobs/buildJobDeps.js";
import {
  buildStandupPushText,
  handleStandupPushEndpoint,
  sendStandupPush,
} from "../../src/jobs/standupPush.js";
import { notifyJobFailure } from "../../src/jobs/notifyJobFailure.js";
import { buildQuoteModel } from "../../src/nlp/quoteModel.js";

/**
 * Vercel serverless function for the standup push endpoint (issue #107,
 * item 5). `GET` renders the same overview card as JSON without sending
 * (a preview); `POST` sends it into the cohort's group. Both methods are
 * authenticated the same way every other `/api/jobs/*` endpoint is
 * (`verifyInternalJobSecret`) — Devie's own `POST /api/standup` has no auth
 * at all, which this ticket treats as an abuse vector, not a carbon-copy
 * rule to keep.
 *
 * Deliberately **absent from `vercel.json`**: Devie schedules nothing here
 * either, and issue #43 is still proving the two existing crons work at
 * all. This endpoint is triggered externally or by hand.
 */
const JOB_NAME = "standup-push";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = loadJobEnv();
  const deps = await buildNotificationJobDeps();
  const model = buildQuoteModel();
  const now = new Date();

  try {
    const result = await handleStandupPushEndpoint(
      {
        verify: (headers) => verifyInternalJobSecret(headers, env.internalJobSecret),
        buildPreview: () =>
          buildStandupPushText({ service: deps.service, model }, env.activeCohortId, now),
        send: () =>
          sendStandupPush(
            { service: deps.service, model, bot: deps.bot, cohorts: deps.cohorts },
            env.activeCohortId,
            now,
          ),
      },
      {
        method: req.method,
        headers: req.headers as Record<string, string | string[] | undefined>,
      },
    );
    res.status(result.status).json(result.body ?? {});
  } catch (error) {
    // `handleStandupPushEndpoint` has no `onError` hook of its own (unlike
    // `handleJobEndpoint`'s envelope) — this is the bespoke-envelope
    // deviation's other half: the self-DM-on-error (ADR-0007) is wired at
    // this adapter layer instead.
    await notifyJobFailure(
      {
        bot: deps.bot,
        registrations: deps.registrations,
        throttle: deps.throttle,
        maintainerUsername: env.maintainerUsername,
      },
      JOB_NAME,
      env.activeCohortId,
      error,
    ).catch(() => {
      // Never let a failure to report the failure change the response.
    });
    res.status(500).json({});
  }
}
