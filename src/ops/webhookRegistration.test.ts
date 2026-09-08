import { describe, expect, it } from "vitest";
import {
  envNamesFor,
  planWebhookRegistration,
  type WebhookRegistrationInput,
} from "./webhookRegistration.js";

/** A fully-populated, valid dry-run input; individual tests override one field. */
function dryRunInput(overrides: Partial<WebhookRegistrationInput> = {}): WebhookRegistrationInput {
  return {
    target: "dry-run",
    actualBotUsername: "devcon_cohort5_dryrun_bot",
    expectedBotUsername: "devcon_cohort5_dryrun_bot",
    deploymentUrl: "https://telegram-taskbot-git-dry-run-example.vercel.app",
    productionDeploymentUrl: "https://telegram-taskbot-ten.vercel.app",
    webhookSecret: "dry-run-secret",
    protectionBypassSecret: "bypass-secret",
    otherTargetBotUsername: "devcon_cohort5_taskbot",
    ...overrides,
  };
}

function productionInput(
  overrides: Partial<WebhookRegistrationInput> = {},
): WebhookRegistrationInput {
  return {
    target: "production",
    actualBotUsername: "devcon_cohort5_taskbot",
    expectedBotUsername: "devcon_cohort5_taskbot",
    deploymentUrl: "https://telegram-taskbot-ten.vercel.app",
    productionDeploymentUrl: "https://telegram-taskbot-ten.vercel.app",
    webhookSecret: "production-secret",
    protectionBypassSecret: "bypass-secret",
    otherTargetBotUsername: "devcon_cohort5_dryrun_bot",
    ...overrides,
  };
}

describe("planWebhookRegistration", () => {
  it("builds the webhook URL and secret token for a valid dry-run target", () => {
    const plan = planWebhookRegistration(dryRunInput());
    expect(plan).toEqual({
      ok: true,
      target: "dry-run",
      url:
        "https://telegram-taskbot-git-dry-run-example.vercel.app/api/telegram/webhook" +
        "?x-vercel-protection-bypass=bypass-secret",
      secretToken: "dry-run-secret",
      warnings: [],
    });
  });

  it("builds the webhook URL for a valid production target", () => {
    const plan = planWebhookRegistration(productionInput());
    expect(plan).toEqual({
      ok: true,
      target: "production",
      url:
        "https://telegram-taskbot-ten.vercel.app/api/telegram/webhook" +
        "?x-vercel-protection-bypass=bypass-secret",
      secretToken: "production-secret",
      warnings: [],
    });
  });

  // Registering without the bypass param is allowed (deployment protection
  // could be off), but on this project it is on for every non-custom domain,
  // so a silent success here would produce a webhook that Vercel's SSO page
  // answers and Telegram never reaches.
  it("omits the Vercel protection-bypass query param when no bypass secret is configured, and warns", () => {
    const plan = planWebhookRegistration(dryRunInput({ protectionBypassSecret: undefined }));
    expect(plan.ok).toBe(true);
    expect(plan.ok === true && plan.url).toBe(
      "https://telegram-taskbot-git-dry-run-example.vercel.app/api/telegram/webhook",
    );
    expect(plan.ok === true && plan.warnings).toEqual([
      expect.stringContaining("VERCEL_PROTECTION_BYPASS"),
    ]);
  });

  it("tolerates a trailing slash on the deployment URL", () => {
    const plan = planWebhookRegistration(
      dryRunInput({ deploymentUrl: "https://telegram-taskbot-git-dry-run-example.vercel.app/" }),
    );
    expect(plan.ok === true && plan.url).toBe(
      "https://telegram-taskbot-git-dry-run-example.vercel.app/api/telegram/webhook" +
        "?x-vercel-protection-bypass=bypass-secret",
    );
  });

  // The load-bearing guardrail: the token in the environment must belong to
  // the bot the target claims to own. This is what stops a mis-set
  // DRYRUN_BOT_TOKEN from repointing the live cohort's bot at a preview.
  it("refuses when the token's real bot is not the one the target expects", () => {
    const plan = planWebhookRegistration(
      dryRunInput({ actualBotUsername: "devcon_cohort5_taskbot" }),
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain("devcon_cohort5_taskbot");
    expect(plan.ok === false && plan.reason).toContain("devcon_cohort5_dryrun_bot");
  });

  it("compares bot usernames case-insensitively, as Telegram does", () => {
    const plan = planWebhookRegistration(
      dryRunInput({ actualBotUsername: "DevCon_Cohort5_DryRun_Bot" }),
    );
    expect(plan.ok).toBe(true);
  });

  it("ignores a leading @ on the configured bot username", () => {
    const plan = planWebhookRegistration(
      dryRunInput({ expectedBotUsername: "@devcon_cohort5_dryrun_bot" }),
    );
    expect(plan.ok).toBe(true);
  });

  // The second guardrail: even with a correct dry-run token, pointing the
  // dry-run bot at the production deployment would put dry-run traffic on
  // the real cohort's deployment (and its ACTIVE_COHORT_ID).
  it("refuses to point the dry-run bot at the production deployment", () => {
    const plan = planWebhookRegistration(
      dryRunInput({ deploymentUrl: "https://telegram-taskbot-ten.vercel.app" }),
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toMatch(/production/i);
  });

  it("compares the dry-run and production URLs by host, ignoring path and trailing slash", () => {
    const plan = planWebhookRegistration(
      dryRunInput({ deploymentUrl: "https://telegram-taskbot-ten.vercel.app/" }),
    );
    expect(plan.ok).toBe(false);
  });

  it("refuses a non-HTTPS deployment URL, which Telegram will not accept", () => {
    const plan = planWebhookRegistration(
      dryRunInput({ deploymentUrl: "http://telegram-taskbot-git-dry-run-example.vercel.app" }),
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toMatch(/https/i);
  });

  it("refuses an unparseable deployment URL", () => {
    const plan = planWebhookRegistration(dryRunInput({ deploymentUrl: "not a url" }));
    expect(plan.ok).toBe(false);
  });

  it.each([
    ["expectedBotUsername", "DRYRUN_BOT_USERNAME"],
    ["deploymentUrl", "DRYRUN_DEPLOYMENT_URL"],
    ["webhookSecret", "DRYRUN_WEBHOOK_SECRET"],
  ] as const)("refuses when %s is missing, naming the env var to set", (field, envVar) => {
    const plan = planWebhookRegistration(dryRunInput({ [field]: undefined }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain(envVar);
  });

  it.each([
    ["expectedBotUsername", "PROD_BOT_USERNAME"],
    ["deploymentUrl", "PRODUCTION_DEPLOYMENT_URL"],
    ["webhookSecret", "TELEGRAM_WEBHOOK_SECRET"],
  ] as const)(
    "names the production env var when %s is missing on the production target",
    (field, envVar) => {
      const plan = planWebhookRegistration(productionInput({ [field]: undefined }));
      expect(plan.ok).toBe(false);
      expect(plan.ok === false && plan.reason).toContain(envVar);
    },
  );

  it("refuses when an empty string is configured, not just an unset value", () => {
    const plan = planWebhookRegistration(dryRunInput({ webhookSecret: "   " }));
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain("DRYRUN_WEBHOOK_SECRET");
  });

  it("refuses when the production target's token turns out to be the dry-run bot", () => {
    // The failure this exists for: BOT_TOKEN and BOT_USERNAME were both moved
    // to the test bot together, so the actual-vs-expected check agreed with
    // itself and the guard passed. Comparing against the *other* target's bot
    // catches a pair that moved in step.
    const plan = planWebhookRegistration(
      productionInput({
        actualBotUsername: "devcon_cohort5_dryrun_bot",
        expectedBotUsername: "devcon_cohort5_dryrun_bot",
      }),
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain("DRYRUN_BOT_USERNAME");
  });

  it("refuses when the dry-run target's token turns out to be the production bot", () => {
    const plan = planWebhookRegistration(
      dryRunInput({
        actualBotUsername: "devcon_cohort5_taskbot",
        expectedBotUsername: "devcon_cohort5_taskbot",
      }),
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain("PROD_BOT_USERNAME");
  });

  it("applies the cross-target check case-insensitively and ignoring a leading @", () => {
    const plan = planWebhookRegistration(
      productionInput({
        actualBotUsername: "DevCon_Cohort5_DryRun_Bot",
        expectedBotUsername: "DevCon_Cohort5_DryRun_Bot",
        otherTargetBotUsername: "@devcon_cohort5_dryrun_bot",
      }),
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain("DRYRUN_BOT_USERNAME");
  });

  it("still succeeds when the other target's bot is not configured at all", () => {
    // A half-configured .env must not block the target that *is* configured.
    expect(planWebhookRegistration(productionInput({ otherTargetBotUsername: undefined })).ok).toBe(
      true,
    );
  });
});

describe("envNamesFor", () => {
  it("reads production's bot identity from PROD_BOT_TOKEN / PROD_BOT_USERNAME", () => {
    // Not BOT_TOKEN: that variable is whatever bot this machine runs locally,
    // which is deliberately the test bot, so a production target reading it
    // reports on - and can repoint - the wrong bot entirely.
    expect(envNamesFor("production")).toEqual({
      botToken: "PROD_BOT_TOKEN",
      botUsername: "PROD_BOT_USERNAME",
      deploymentUrl: "PRODUCTION_DEPLOYMENT_URL",
      webhookSecret: "TELEGRAM_WEBHOOK_SECRET",
    });
  });

  it("reads the dry run's bot identity from DRYRUN_BOT_TOKEN / DRYRUN_BOT_USERNAME", () => {
    expect(envNamesFor("dry-run")).toEqual({
      botToken: "DRYRUN_BOT_TOKEN",
      botUsername: "DRYRUN_BOT_USERNAME",
      deploymentUrl: "DRYRUN_DEPLOYMENT_URL",
      webhookSecret: "DRYRUN_WEBHOOK_SECRET",
    });
  });

  it("gives the two targets entirely disjoint env vars", () => {
    // The invariant behind ADR-0011: two bots, two secrets, two URLs. If any
    // single variable were shared, one command could move both loops.
    const prod = Object.values(envNamesFor("production"));
    const dry = Object.values(envNamesFor("dry-run"));
    expect(prod.filter((name) => dry.includes(name))).toEqual([]);
  });
});
