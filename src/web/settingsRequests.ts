import type { Caller } from "../domain/types.js";

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
 * the card text without sending, `"test"` posts it into the cohort's group. */
export function parseStandupRequest(body: unknown): ParsedRequest<{ mode: "preview" | "test" }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const mode = record.mode;
  if (mode !== "preview" && mode !== "test") {
    return fail(`"mode" is required and must be "preview" or "test".`);
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
