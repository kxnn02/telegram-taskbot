import "dotenv/config";
import {
  planWebhookRegistration,
  type WebhookTarget,
} from "../src/ops/webhookRegistration.js";

/**
 * Registers a bot's Telegram webhook against one of this project's two
 * deployments (ADR-0011): the production bot against production, or the
 * dry-run bot against the `dry-run` branch deployment.
 *
 * Run it as:
 *   npm run webhook:register -- --target dry-run
 *   npm run webhook:register -- --target dry-run --check
 *   npm run webhook:register -- --target production --confirm-production
 *
 * All the refusal logic lives in `planWebhookRegistration`
 * (`src/ops/webhookRegistration.ts`) and is unit-tested there; this file is
 * the I/O shell: read env, ask Telegram who the token belongs to, print the
 * plan, and (unless `--check`) write it. Production additionally needs
 * `--confirm-production`, because that is the one invocation that can take
 * the live cohort's bot offline — a flag you have to type on purpose is the
 * difference between "wrong command" and "outage".
 *
 * Secrets are never printed: the URL is shown with the protection-bypass
 * value masked, and the webhook secret is only ever reported as set/unset.
 */

const TELEGRAM_API = "https://api.telegram.org";

interface Args {
  target: WebhookTarget;
  check: boolean;
  confirmProduction: boolean;
  dropPending: boolean;
}

function parseArgs(argv: string[]): Args {
  const targetIndex = argv.indexOf("--target");
  const rawTarget = targetIndex === -1 ? undefined : argv[targetIndex + 1];
  if (rawTarget !== "production" && rawTarget !== "dry-run") {
    throw new Error(
      "Usage: npm run webhook:register -- --target <production|dry-run> [--check] " +
        "[--confirm-production] [--drop-pending]",
    );
  }
  return {
    target: rawTarget,
    check: argv.includes("--check"),
    confirmProduction: argv.includes("--confirm-production"),
    dropPending: argv.includes("--drop-pending"),
  };
}

/** Env var holding the bot token for each target — deliberately two distinct bots (ADR-0011). */
function tokenFor(target: WebhookTarget): { envVar: string; token: string | undefined } {
  const envVar = target === "production" ? "BOT_TOKEN" : "DRYRUN_BOT_TOKEN";
  return { envVar, token: process.env[envVar]?.trim() || undefined };
}

async function callTelegram<T>(token: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!payload.ok) {
    // Telegram echoes nothing sensitive back here, but the token is in the URL
    // above and must never reach a log line.
    throw new Error(`Telegram ${method} failed: ${payload.description ?? response.status}`);
  }
  return payload.result as T;
}

/** Replaces the protection-bypass secret's value so a plan can be safely printed or logged. */
function maskUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.searchParams.has("x-vercel-protection-bypass")) {
    parsed.searchParams.set("x-vercel-protection-bypass", "***");
  }
  return parsed.toString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { envVar, token } = tokenFor(args.target);
  if (!token) {
    throw new Error(`${envVar} is not set — needed to register the ${args.target} webhook.`);
  }

  const me = await callTelegram<{ username: string }>(token, "getMe");

  const plan = planWebhookRegistration({
    target: args.target,
    actualBotUsername: me.username,
    expectedBotUsername:
      args.target === "production" ? process.env.BOT_USERNAME : process.env.DRYRUN_BOT_USERNAME,
    deploymentUrl:
      args.target === "production"
        ? process.env.PRODUCTION_DEPLOYMENT_URL
        : process.env.DRYRUN_DEPLOYMENT_URL,
    productionDeploymentUrl: process.env.PRODUCTION_DEPLOYMENT_URL,
    webhookSecret:
      args.target === "production"
        ? process.env.TELEGRAM_WEBHOOK_SECRET
        : process.env.DRYRUN_WEBHOOK_SECRET,
    protectionBypassSecret: process.env.VERCEL_PROTECTION_BYPASS,
  });

  if (!plan.ok) {
    throw new Error(plan.reason);
  }

  /* eslint-disable no-console */
  console.log(`target:  ${plan.target}`);
  console.log(`bot:     @${me.username} (from ${envVar})`);
  console.log(`url:     ${maskUrl(plan.url)}`);
  console.log(`secret:  set (${plan.secretToken.length} chars, not printed)`);
  for (const warning of plan.warnings) {
    console.log(`WARNING: ${warning}`);
  }

  const before = await callTelegram<{ url: string; last_error_message?: string }>(
    token,
    "getWebhookInfo",
  );
  console.log(`current: ${before.url ? maskUrl(before.url) : "(none registered)"}`);

  if (args.check) {
    console.log("\n--check given: nothing was written.");
    return;
  }
  if (args.target === "production" && !args.confirmProduction) {
    throw new Error(
      "Refusing to repoint the production webhook without --confirm-production. " +
        "This is the live cohort's bot; re-run with that flag if you mean it.",
    );
  }

  await callTelegram(token, "setWebhook", {
    url: plan.url,
    secret_token: plan.secretToken,
    drop_pending_updates: args.dropPending,
  });

  const after = await callTelegram<{ url: string; last_error_message?: string }>(
    token,
    "getWebhookInfo",
  );
  console.log(`\nregistered: ${maskUrl(after.url)}`);
  if (after.last_error_message) {
    console.log(`last error (may predate this call): ${after.last_error_message}`);
  }
  /* eslint-enable no-console */
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
