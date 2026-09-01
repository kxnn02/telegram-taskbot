/**
 * Shared HTTP envelope for every `/api/jobs/*` endpoint (ADR-0007),
 * independent of any Vercel/HTTP types, mirroring `handleTelegramWebhook`'s
 * design (`src/webhook/webhookHandler.ts`): unit-testable with plain
 * objects, with the thin `api/jobs/*.ts` files adapting a real
 * `VercelRequest`/`VercelResponse` to/from this shape.
 *
 * Deliberately generic over *how* a request is authenticated (`verify`) so
 * the same envelope backs both the `pg_net`-triggered notification-job
 * endpoints (custom internal-secret header) and the Vercel-Cron-triggered
 * endpoints (Vercel's own `Authorization: Bearer $CRON_SECRET` convention) —
 * see `src/jobs/jobAuth.ts` for the two verification functions passed in
 * here.
 */

export interface MinimalJobRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface MinimalJobResponse {
  status: number;
  body?: unknown;
}

export interface JobEndpointDeps {
  /** Checks the request's auth header(s) against the expected secret. */
  verify(headers: Record<string, string | string[] | undefined>): boolean;
  /** The job's actual work. Any thrown error is caught, reported via
   * `onError`, and turned into a 500 — never left to crash the function. */
  work(): Promise<void>;
  /** Self-DM-on-error (ADR-0007), already throttled by the caller (see
   * `notifyJobFailure`). Errors thrown by `onError` itself are swallowed —
   * a failure to *report* a failure must not change the response the
   * caller (pg_net/Vercel Cron) sees, which is already a 500 either way. */
  onError(error: unknown): Promise<void>;
}

/**
 * Runs one job's HTTP envelope: only accepts POST (matching how `pg_net`
 * and Vercel Cron both call these — no query-string-driven GET jobs), then
 * authenticates, then runs the job's work, reporting and swallowing any
 * failure into a 500 rather than letting it propagate as an unhandled
 * rejection.
 */
export async function handleJobEndpoint(
  deps: JobEndpointDeps,
  req: MinimalJobRequest,
): Promise<MinimalJobResponse> {
  if (req.method !== "POST") {
    return { status: 405 };
  }
  if (!deps.verify(req.headers)) {
    return { status: 401 };
  }
  try {
    await deps.work();
  } catch (error) {
    try {
      await deps.onError(error);
    } catch {
      // Never let a failure to report the failure change the response.
    }
    return { status: 500 };
  }
  return { status: 200 };
}
