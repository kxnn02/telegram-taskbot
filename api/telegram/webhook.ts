import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { createBot, registerBotCommands } from "../../src/bot/createBot.js";
import { createSupabaseClient } from "../../src/storage/supabaseClient.js";
import { SupabaseTaskStore } from "../../src/storage/supabaseTaskStore.js";
import { SupabaseRegistrationStore } from "../../src/storage/supabaseRegistrationStore.js";
import { SupabaseWizardStateStore } from "../../src/storage/supabaseWizardStateStore.js";
import { SupabaseRosterStore } from "../../src/storage/supabaseRosterStore.js";
import { SupabaseProcessedUpdatesStore } from "../../src/storage/supabaseProcessedUpdatesStore.js";
import { loadRosterFromStore } from "../../src/config/roster.js";
import { handleTelegramWebhook, type WebhookHandlerDeps } from "../../src/webhook/webhookHandler.js";

/**
 * Vercel serverless function entrypoint for the Telegram webhook
 * (ADR-0001/ADR-0004). Deliberately a bare `/api` function, not a Next.js
 * route handler — the Next.js rewrite is Phase 6 (issue #17); Vercel
 * auto-detects any file under `/api` as a serverless function regardless
 * of framework. This file is intentionally thin: all the actual logic
 * (secret check, dedup, dispatch) lives in `handleTelegramWebhook`
 * (`src/webhook/webhookHandler.ts`), which is unit-tested directly without
 * needing a live deploy — this wrapper just adapts a real
 * `VercelRequest`/`VercelResponse` to/from that function's plain shape.
 *
 * `ACTIVE_COHORT_ID` binds this specific deployment to exactly one cohort
 * (CONTEXT.md's cohort-binding note): the real cohort and the dry-run
 * cohort each get their own deployed branch/env, never one instance
 * serving both, since the dry run reuses real accounts across cohorts and
 * caller resolution can't safely guess between them.
 */

let depsPromise: Promise<WebhookHandlerDeps> | undefined;

async function buildDeps(): Promise<WebhookHandlerDeps> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN is not set.");
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is not set.");
  }
  const activeCohortId = process.env.ACTIVE_COHORT_ID;
  if (!activeCohortId) {
    throw new Error("ACTIVE_COHORT_ID is not set.");
  }

  const supabase = createSupabaseClient();
  const rosterStore = new SupabaseRosterStore(supabase);
  const roster = await loadRosterFromStore(rosterStore);

  const { bot } = createBot({
    token,
    taskStore: new SupabaseTaskStore(supabase),
    registrationStore: new SupabaseRegistrationStore(supabase),
    wizardStateStore: new SupabaseWizardStateStore(supabase),
    roster,
    activeCohortId,
    dashboardUrl:
      process.env.DASHBOARD_URL ?? "https://example.com/dashboard-coming-soon",
  });
  // Webhook mode (unlike bot.start()'s long polling) needs bot.init() called
  // once so grammy has its own bot info (id, username, etc.) cached before
  // handleUpdate is ever called.
  await bot.init();
  // Cheap and idempotent — runs once per cold Lambda start, not per
  // request, since buildDeps() is memoized via depsPromise below.
  await registerBotCommands(bot);

  const processedUpdates = new SupabaseProcessedUpdatesStore(supabase);

  return {
    bot,
    expectedSecret: secret,
    claimUpdate: (updateId: number) => processedUpdates.claim(updateId),
    refreshRoster: async () => roster.replaceAll(await rosterStore.listAll()),
  };
}

/** Cached at module scope so a warm Lambda invocation reuses the same bot/
 * service/store stack instead of rebuilding it (and re-running bot.init()'s
 * network call) on every single request. Cleared on failure so a later
 * invocation can retry after a transient error (e.g. Supabase briefly
 * unreachable) instead of failing forever until a redeploy. */
function getDeps(): Promise<WebhookHandlerDeps> {
  if (!depsPromise) {
    depsPromise = buildDeps().catch((err) => {
      depsPromise = undefined;
      throw err;
    });
  }
  return depsPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({});
    return;
  }
  const deps = await getDeps();
  const result = await handleTelegramWebhook(deps, {
    method: req.method,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: req.body,
  });
  res.status(result.status).json(result.body ?? {});
}
