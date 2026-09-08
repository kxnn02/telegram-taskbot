import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Bot } from "grammy";
import { attachAutoRetry } from "../../../../src/bot/attachAutoRetry";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { buildWebhookStatusResponse, isMaintainer } from "../../../../src/web/settingsRequests";
import { planWebhookRegistration } from "../../../../src/ops/webhookRegistration";

/**
 * The Bot Connection section's webhook status/register routes (issue #130).
 *
 * `GET` is open to any signed-in cohort member — `getWebhookInfo` is
 * read-only. `POST` (Register) repoints the *production* webhook and is
 * gated to `MAINTAINER_USERNAME`: a mis-click here silences the live bot
 * for the whole cohort until someone notices, so this is the one button in
 * this section that isn't safe for anyone to press.
 *
 * Both construct `new Bot(deps.botToken)` per request and use only
 * `bot.api` — no `bot.init()`/`bot.start()` (Build 0c): this is a webhook
 * deployment, and starting a long-poll loop from a dashboard route would
 * fight the live webhook.
 */
export async function GET() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const maintainerUsername = process.env.MAINTAINER_USERNAME;
  const maintainer = Boolean(maintainerUsername && isMaintainer(caller, maintainerUsername));

  try {
    const bot = new Bot(deps.botToken);
    attachAutoRetry(bot);
    const info = await bot.api.getWebhookInfo();
    return NextResponse.json({
      ok: true,
      ...buildWebhookStatusResponse({ ...info, url: info.url ?? "" }),
      isMaintainer: maintainer,
      // Only handed to the one caller who can press Register — the exact
      // destination the confirmation dialog names before it fires.
      registerTargetUrl: maintainer ? process.env.PRODUCTION_DEPLOYMENT_URL : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to reach Telegram." },
      { status: 502 },
    );
  }
}

export async function POST() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const maintainerUsername = process.env.MAINTAINER_USERNAME;
  if (!maintainerUsername || !isMaintainer(caller, maintainerUsername)) {
    return NextResponse.json({ ok: false, error: "Maintainer only." }, { status: 403 });
  }

  const bot = new Bot(deps.botToken);
  attachAutoRetry(bot);
  let actualBotUsername: string;
  try {
    actualBotUsername = (await bot.api.getMe()).username;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to reach Telegram." },
      { status: 502 },
    );
  }

  const plan = planWebhookRegistration({
    target: "production",
    actualBotUsername,
    expectedBotUsername: process.env.BOT_USERNAME,
    deploymentUrl: process.env.PRODUCTION_DEPLOYMENT_URL,
    productionDeploymentUrl: process.env.PRODUCTION_DEPLOYMENT_URL,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    protectionBypassSecret: process.env.VERCEL_PROTECTION_BYPASS,
  });
  if (!plan.ok) {
    return NextResponse.json({ ok: false, error: plan.reason }, { status: 400 });
  }

  await bot.api.setWebhook(plan.url, { secret_token: plan.secretToken });
  return NextResponse.json({ ok: true, warnings: plan.warnings });
}
