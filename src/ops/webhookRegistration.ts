/**
 * Guardrails for repointing a Telegram bot's webhook (ADR-0011's post-cutover
 * dry-run loop).
 *
 * Registering a webhook is the single most dangerous operation in this
 * project's operations: a bot token can only have one active webhook at a
 * time, so one mistyped command against the production token silently takes
 * the live cohort's bot offline, with no error anywhere — Telegram simply
 * starts delivering updates to the wrong URL. Before the cutover that risk
 * was theoretical (one bot, one deployment); with a second bot for the
 * dry-run loop there are now two tokens and two URLs sitting next to each
 * other in the same `.env`, which is exactly the shape that gets
 * copy-pasted wrong.
 *
 * So the decision of *what* to register is a pure function, unit-tested
 * here, and `scripts/registerWebhook.ts` is a thin shell around it that
 * does the two network calls (getMe, setWebhook). The check that actually
 * matters is `actualBotUsername` vs `expectedBotUsername`: the token is
 * resolved to a real bot identity via getMe *before* anything is written,
 * so a token in the wrong variable is caught by what the token actually
 * is, not by what the variable is named.
 */

export type WebhookTarget = "production" | "dry-run";

export interface WebhookRegistrationInput {
  /** Which deployment is being pointed at — decides which env vars are read. */
  target: WebhookTarget;
  /** The bot the supplied token actually belongs to, from Telegram's getMe. */
  actualBotUsername: string;
  /** The bot this target is configured to own (BOT_USERNAME/DRYRUN_BOT_USERNAME). */
  expectedBotUsername: string | undefined;
  /** Base URL of this target's deployment, without the webhook path. */
  deploymentUrl: string | undefined;
  /** Production's base URL, used to keep the dry-run bot off the live deployment. */
  productionDeploymentUrl: string | undefined;
  /** Value Telegram echoes back in X-Telegram-Bot-Api-Secret-Token (ADR-0004). */
  webhookSecret: string | undefined;
  /**
   * Vercel "Protection Bypass for Automation" secret. Deployment protection is
   * enabled for every non-custom domain on this project, so without this query
   * param Telegram's POSTs are answered by Vercel's SSO page and never reach
   * the function — the live webhook carries it too.
   */
  protectionBypassSecret: string | undefined;
}

export type WebhookRegistrationPlan =
  | {
      ok: true;
      target: WebhookTarget;
      url: string;
      secretToken: string;
      /** Non-fatal problems worth printing before the write goes ahead. */
      warnings: string[];
    }
  | { ok: false; reason: string };

/** The env var names each target reads, so a refusal can name the exact one to fix. */
const ENV_VARS: Record<
  WebhookTarget,
  { botUsername: string; deploymentUrl: string; webhookSecret: string }
> = {
  production: {
    botUsername: "BOT_USERNAME",
    deploymentUrl: "PRODUCTION_DEPLOYMENT_URL",
    webhookSecret: "TELEGRAM_WEBHOOK_SECRET",
  },
  "dry-run": {
    botUsername: "DRYRUN_BOT_USERNAME",
    deploymentUrl: "DRYRUN_DEPLOYMENT_URL",
    webhookSecret: "DRYRUN_WEBHOOK_SECRET",
  },
};

/** Treats whitespace-only config the same as unset — a blank line in `.env` is not a value. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Telegram usernames are case-insensitive, and are written with or without the @. */
function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

export function planWebhookRegistration(
  input: WebhookRegistrationInput,
): WebhookRegistrationPlan {
  const envVars = ENV_VARS[input.target];

  const expectedBotUsername = present(input.expectedBotUsername);
  if (!expectedBotUsername) {
    return { ok: false, reason: `${envVars.botUsername} is not set.` };
  }
  const deploymentUrl = present(input.deploymentUrl);
  if (!deploymentUrl) {
    return { ok: false, reason: `${envVars.deploymentUrl} is not set.` };
  }
  const webhookSecret = present(input.webhookSecret);
  if (!webhookSecret) {
    return { ok: false, reason: `${envVars.webhookSecret} is not set.` };
  }

  if (normalizeUsername(input.actualBotUsername) !== normalizeUsername(expectedBotUsername)) {
    return {
      ok: false,
      reason:
        `Token mismatch: the configured token belongs to @${input.actualBotUsername}, but the ` +
        `${input.target} target expects @${normalizeUsername(expectedBotUsername)} ` +
        `(${envVars.botUsername}). Refusing to repoint a bot that is not this target's.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(deploymentUrl);
  } catch {
    return { ok: false, reason: `${envVars.deploymentUrl} is not a valid URL: ${deploymentUrl}` };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `${envVars.deploymentUrl} must be an https URL — Telegram refuses any other scheme.`,
    };
  }

  // Compared by host, not by string: a trailing slash or a stray path is the
  // likely shape of this mistake, and neither changes which deployment the
  // updates would land on.
  if (input.target === "dry-run") {
    const productionUrl = present(input.productionDeploymentUrl);
    let productionHost: string | undefined;
    try {
      productionHost = productionUrl ? new URL(productionUrl).host : undefined;
    } catch {
      productionHost = undefined;
    }
    if (productionHost && parsed.host === productionHost) {
      return {
        ok: false,
        reason:
          `${envVars.deploymentUrl} points at the production deployment (${productionHost}). ` +
          "The dry-run bot must target its own branch deployment, or dry-run traffic would " +
          "run against the live cohort's deployment.",
      };
    }
  }

  const url = new URL("/api/telegram/webhook", parsed.origin);
  const warnings: string[] = [];
  const bypass = present(input.protectionBypassSecret);
  if (bypass) {
    url.searchParams.set("x-vercel-protection-bypass", bypass);
  } else {
    // Not fatal — deployment protection can legitimately be off — but on this
    // project it is on for every non-custom domain, and the resulting failure
    // is silent from Telegram's side: it gets Vercel's SSO page, the function
    // is never invoked, and the bot simply stops responding.
    warnings.push(
      "VERCEL_PROTECTION_BYPASS is not set, so the webhook URL carries no protection-bypass " +
        "param. If Vercel deployment protection is enabled for this deployment, Telegram's " +
        "requests will be answered by the SSO page and never reach the bot.",
    );
  }

  return {
    ok: true,
    target: input.target,
    url: url.toString(),
    secretToken: webhookSecret,
    warnings,
  };
}
