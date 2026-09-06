/**
 * Request-parsing/validation for the Next.js settings-page API route
 * (issue #105 sub-stage 5c) — same split as `taskMutationRequests.ts`:
 * structural body-shape checks only, business rules live in
 * `SettingsService`.
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
