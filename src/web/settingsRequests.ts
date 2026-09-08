import type { Caller } from "../domain/types.js";
import {
  planWebhookRegistration,
  type WebhookRegistrationPlan,
} from "../ops/webhookRegistration.js";

/**
 * Request-parsing/validation for the Next.js settings-page API route
 * (issue #105 sub-stage 5c) — same split as `taskMutationRequests.ts`:
 * structural body-shape checks only, business rules live in
 * `SettingsService`. Extended (issue #130) for the Bot Connection/Daily
 * Standup section's four routes: same split, same file.
 */

export type ParsedRequest<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): ParsedRequest<T> {
  return { ok: false, error };
}

function asRecord(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  return body as Record<string, unknown>;
}

/** `groupChatId` is required and must be a string — an empty string is a
 * legal value, meaning "clear the configured group chat" (`cohorts.
 * group_chat_id` is nullable). Unlike Devie's `chat_id`, there is no
 * accompanying bot-token field: that field and the whole `telegram_config`
 * concept are dropped per the ticket's decision 2. */
export function parseSaveSettingsRequest(body: unknown): ParsedRequest<{ groupChatId: string }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const groupChatId = record.groupChatId;
  if (typeof groupChatId !== "string") {
    return fail(`"groupChatId" is required and must be a string.`);
  }
  return { ok: true, value: { groupChatId } };
}

/** `mode` picks `POST /api/settings/standup`'s branch: `"preview"` renders
 * the card text without sending, `"test"` posts it into the cohort's group
 * regardless of the Auto-standup switch (issue #131 Build 3 — testing a
 * standup you haven't enabled yet is the whole point of the button), and
 * `"enable"`/`"disable"` (issue #131 Build 4) flip that switch itself. */
export function parseStandupRequest(
  body: unknown,
): ParsedRequest<{ mode: "preview" | "test" | "enable" | "disable" }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const mode = record.mode;
  if (mode !== "preview" && mode !== "test" && mode !== "enable" && mode !== "disable") {
    return fail(`"mode" is required and must be "preview", "test", "enable" or "disable".`);
  }
  return { ok: true, value: { mode } };
}

/** Telegram usernames are case-insensitive and are written with or without
 * a leading `@` — same normalization `src/ops/webhookRegistration.ts` uses
 * for its own username comparison. Gates `POST /api/settings/webhook`
 * (Register) to `MAINTAINER_USERNAME` (issue #130 decision: the other four
 * buttons in this section are not maintainer-gated). */
export function isMaintainer(caller: Caller, maintainerUsername: string): boolean {
  const normalize = (username: string) => username.trim().replace(/^@/, "").toLowerCase();
  return normalize(caller.username) === normalize(maintainerUsername);
}

/** Strips the Vercel protection-bypass query param (and anything else in
 * the query string) before a webhook URL reaches the browser — that param
 * is a secret this deployment's webhook URL carries
 * (`src/ops/webhookRegistration.ts`), which Devie's own URL has no analog
 * for. An empty string (webhook not registered) passes through unchanged. */
export function stripWebhookUrlQuery(url: string): string {
  if (!url) return url;
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export interface WebhookStatus {
  url: string;
  pendingCount: number;
  lastError: string | undefined;
}

/** Shapes Telegram's `getWebhookInfo` result for `GET /api/settings/webhook`. */
export function buildWebhookStatusResponse(info: {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
}): WebhookStatus {
  return {
    url: stripWebhookUrlQuery(info.url),
    pendingCount: info.pending_update_count,
    lastError: info.last_error_message,
  };
}

/**
 * Decides whether the dashboard's Register button may repoint the production
 * webhook, given the env of the deployment the button was pressed on.
 *
 * The button's destination is always `PRODUCTION_DEPLOYMENT_URL`, but the
 * token it would write with is whatever bot the *current* deployment runs as
 * (`deps.botToken`). Those two are only the same thing on production. The
 * route used to check that token against `BOT_USERNAME` — the current
 * deployment's own bot — so on the dry-run deployment the check compared the
 * dry-run bot against itself, passed, and would have pointed the dry-run bot
 * at production's URL: the dry-run loop silently dead, and the two loops
 * crossed (ADR-0011).
 *
 * So the identity is checked against `PROD_BOT_USERNAME`, which names the
 * production bot and nothing else. It is read with no fallback on purpose:
 * when it is unset the button fails closed with a message naming it, rather
 * than quietly reverting to "whichever bot is here".
 */
export function planDashboardWebhookRegistration(input: {
  actualBotUsername: string;
  env: Record<string, string | undefined>;
}): WebhookRegistrationPlan {
  const { env } = input;
  return planWebhookRegistration({
    target: "production",
    actualBotUsername: input.actualBotUsername,
    expectedBotUsername: env.PROD_BOT_USERNAME,
    otherTargetBotUsername: env.DRYRUN_BOT_USERNAME,
    deploymentUrl: env.PRODUCTION_DEPLOYMENT_URL,
    productionDeploymentUrl: env.PRODUCTION_DEPLOYMENT_URL,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    protectionBypassSecret: env.VERCEL_PROTECTION_BYPASS,
  });
}
