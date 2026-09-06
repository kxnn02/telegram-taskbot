/**
 * Request-parsing/validation for the team page's Next.js API routes (issue
 * #105 sub-stage 5d), same split as `settingsRequests.ts`/
 * `taskMutationRequests.ts`: structural body-shape checks only, business
 * rules (uniqueness, normalization) live in `RosterService`.
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

function requireUsername(body: unknown): ParsedRequest<{ username: string }> {
  const record = asRecord(body);
  if (!record) return fail("Request body must be a JSON object.");

  const username = record.username;
  if (typeof username !== "string" || username.trim().length === 0) {
    return fail(`"username" is required and must be a non-empty string.`);
  }
  return { ok: true, value: { username } };
}

/** `POST /api/team` — add a member. Devie's form also collects a display
 * name and role; neither exists in this repo's roster (a row is just
 * `(username, cohort_id)`, ADR-0003/ADR-0013), so `username` is the only
 * field. */
export function parseAddMemberRequest(body: unknown): ParsedRequest<{ username: string }> {
  return requireUsername(body);
}

/** `PATCH /api/team/[username]` — rename a member (correcting a typo, or a
 * changed Telegram handle). There is no role to edit any more, so this is
 * the only mutation left for an existing roster row besides removal. */
export function parseRenameMemberRequest(body: unknown): ParsedRequest<{ username: string }> {
  return requireUsername(body);
}
