import type { TaskService } from "../service/taskService.js";
import type { CohortStorePort } from "../storage/cohortStorePort.js";
import type { TextModel } from "../nlp/textModel.js";
import type { Caller } from "../domain/types.js";
import { buildStandup } from "../bot/standup.js";
import { buildStandupOverviewCard } from "../bot/standupOverviewCard.js";
import { dailyQuote } from "../bot/standupQuote.js";

/**
 * Issue #107, item 5: the standup push endpoint — Devie's
 * `app/api/standup/route.ts`, ported with two deliberate deviations (see
 * the ticket): the bot token stays in an env var (never read from a
 * `telegram_config` table), and every request — `GET` (preview) and `POST`
 * (send) alike — is authenticated via this repo's existing
 * `src/jobs/jobAuth.ts` scheme (`verifyInternalJobSecret`), never a new one.
 * Devie's own endpoint has no auth of any kind, which is an open abuse
 * vector on a group real people are in.
 *
 * Scheduled by pg_cron (issue #131) at `5 0 * * *` (00:05 UTC = 8:05am
 * Asia/Manila), gated on `cohorts.standup_enabled` — see Build 3 there for
 * why the check lives here, in the POST branch only, rather than in
 * `sendStandupPush` (shared with the settings page's Test button, which
 * must ignore the flag) or in the Vercel adapter file (untested, and never
 * will be). Still absent from `vercel.json`: this repo schedules through
 * pg_cron rather than Vercel Cron, which issue #43 is still proving even
 * works.
 */

/** Narrow slice of grammy's `Bot` this module needs — a `parse_mode`-aware
 * superset of `notifications/scheduler.ts`'s `NotifierBot`, since the push
 * card is HTML. `NotifierBot.api.sendMessage` already accepts this third,
 * optional argument (widened alongside this change), so a real grammy `Bot`
 * satisfies both without adapting. */
export interface StandupPushBot {
  api: {
    sendMessage(
      chatId: number | string,
      text: string,
      other?: { parse_mode?: "HTML" },
    ): Promise<unknown>;
  };
}

export interface StandupPushCoreDeps {
  service: TaskService;
  model: TextModel;
}

/** A synthetic caller used only to reach `TaskService.listAllTasks` — there
 * is no access-control tier any more (ADR-0013), so this exists purely to
 * satisfy the method's signature, the same pattern as
 * `notifications/scheduler.ts`'s `schedulerCaller`. */
function pushCaller(cohortId: string): Caller {
  return { username: "__standup_push__", cohortId };
}

/**
 * Builds the push card's text for one cohort — used by both the `POST`
 * (send) and `GET` (preview) paths, so the preview is guaranteed to be
 * exactly what would have been sent. Calls the model exactly once (for the
 * quote), regardless of preview vs. send.
 */
export async function buildStandupPushText(
  deps: StandupPushCoreDeps,
  cohortId: string,
  now: Date,
): Promise<string> {
  const report = await buildStandup(deps.service, pushCaller(cohortId), now);
  const quote = await dailyQuote(deps.model);
  return buildStandupOverviewCard(report, { now, quote });
}

export interface StandupPushSendDeps extends StandupPushCoreDeps {
  bot: StandupPushBot;
  cohorts: CohortStorePort;
}

export interface StandupPushResult {
  sent: boolean;
}

/**
 * Sends the push card into the cohort's configured group chat. Mirrors
 * `runDailyDigest`'s own "skip silently, not an error" handling of an
 * unconfigured `group_chat_id` (`notifications/scheduler.ts`) — a cohort
 * that hasn't linked a group yet is expected, not a failure worth a 500.
 */
export async function sendStandupPush(
  deps: StandupPushSendDeps,
  cohortId: string,
  now: Date,
): Promise<StandupPushResult> {
  const text = await buildStandupPushText(deps, cohortId, now);
  const groupChatId = await deps.cohorts.getGroupChatId(cohortId);
  if (!groupChatId) return { sent: false };
  await deps.bot.api.sendMessage(groupChatId, text, { parse_mode: "HTML" });
  return { sent: true };
}

// ---- HTTP envelope --------------------------------------------------------

export interface MinimalJobRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface MinimalJobResponse {
  status: number;
  body?: unknown;
}

export interface StandupPushEndpointDeps {
  /** Same `verifyInternalJobSecret`-shaped check every other job endpoint
   * uses (`src/jobs/jobAuth.ts`) — applied to *every* method here, `GET`
   * included, since a preview still reads live cohort task data. */
  verify(headers: Record<string, string | string[] | undefined>): boolean;
  buildPreview(): Promise<string>;
  send(): Promise<StandupPushResult>;
  /** Read on the POST path only — the cron schedule must honour the
   * cohort's Auto-standup switch (issue #131), while the settings page's
   * Test button (`POST /api/settings/standup` with `mode: "test"`) calls
   * `sendStandupPush` directly and never reaches this envelope, so it is
   * unaffected. */
  isEnabled(): Promise<boolean>;
}

/**
 * A bespoke envelope rather than a reuse of `handleJobEndpoint`
 * (`jobEndpoint.ts`): every other job endpoint reacts to exactly one
 * triggered method (`POST`), but this one deliberately exposes two —
 * Devie's own `GET` preview / `POST` send split (item 5). The
 * authentication *scheme* is still exactly `jobAuth.ts`'s — only the
 * method-dispatch shape around it differs, and only because this endpoint
 * has two legitimate methods where every other one has one.
 */
export async function handleStandupPushEndpoint(
  deps: StandupPushEndpointDeps,
  req: MinimalJobRequest,
): Promise<MinimalJobResponse> {
  if (req.method !== "GET" && req.method !== "POST") {
    return { status: 405 };
  }
  if (!deps.verify(req.headers)) {
    return { status: 401 };
  }
  if (req.method === "GET") {
    const preview = await deps.buildPreview();
    return { status: 200, body: { preview } };
  }
  const enabled = await deps.isEnabled();
  if (!enabled) {
    // A disabled cohort is an expected state, not an error — skip silently
    // and never fire the failure-notification path (issue #131 Build 3).
    return { status: 200, body: { sent: false } };
  }
  const result = await deps.send();
  return { status: 200, body: result };
}
