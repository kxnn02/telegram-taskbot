import type { Update } from "grammy/types";
import { headerValue, secretMatches } from "./internalSecret.js";

/**
 * Minimal request shape the core webhook logic needs — deliberately not
 * `VercelRequest` itself, so this logic is directly unit-testable with a
 * plain object instead of a real HTTP request (ADR-0004's Vercel
 * serverless-function decision: no `vercel dev`/live deploy needed to
 * verify it works). The thin wrapper in `api/telegram/webhook.ts` adapts a
 * real `VercelRequest`/`VercelResponse` to/from this shape.
 */
export interface MinimalWebhookRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface MinimalWebhookResponse {
  status: number;
  body?: unknown;
}

/** Narrow slice of grammy's `Bot` this handler actually needs. */
export interface UpdateHandler {
  handleUpdate(update: Update): Promise<void>;
}

export interface WebhookHandlerDeps {
  bot: UpdateHandler;
  /** Expected value of Telegram's `X-Telegram-Bot-Api-Secret-Token` header
   * (ADR-0004) — checked before trusting any incoming request. */
  expectedSecret: string;
  /** Atomically claims an update id (ADR-0004); returns `true` if this call
   * is the one that should process it, `false` if it's a duplicate
   * delivery. */
  claimUpdate(updateId: number): Promise<boolean>;
}

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Core Telegram webhook logic (ADR-0004), independent of any Vercel/HTTP
 * types: verifies the secret-token header, atomically claims the update id
 * for dedup, and hands a claimed update to grammy's `bot.handleUpdate`.
 *
 * Order matters: the secret check happens before anything else, including
 * before touching the request body — a request with a bad/missing secret
 * gets a 401 and nothing else happens, regardless of what it claims to
 * contain.
 */
export async function handleTelegramWebhook(
  deps: WebhookHandlerDeps,
  req: MinimalWebhookRequest,
): Promise<MinimalWebhookResponse> {
  const secret = headerValue(req.headers, SECRET_HEADER);
  if (!secretMatches(secret, deps.expectedSecret)) {
    return { status: 401 };
  }

  const update = req.body as Update | undefined;
  if (!update || typeof update.update_id !== "number") {
    return { status: 400 };
  }

  const claimed = await deps.claimUpdate(update.update_id);
  if (!claimed) {
    // Already processed by an earlier delivery of the same update — no-op,
    // but still 200 so Telegram doesn't keep retrying.
    return { status: 200 };
  }

  await deps.bot.handleUpdate(update);
  return { status: 200 };
}
