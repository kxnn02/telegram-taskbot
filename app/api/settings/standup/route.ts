import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { Bot } from "grammy";
import { attachAutoRetry } from "../../../../src/bot/attachAutoRetry";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { parseStandupRequest } from "../../../../src/web/settingsRequests";
import { buildQuoteModel } from "../../../../src/nlp/quoteModel";
import { buildStandupPushText, sendStandupPush } from "../../../../src/jobs/standupPush";

/**
 * The Daily Standup (DSU) section's Preview/Test routes (issue #130), plus
 * the Auto-standup on/off switch (issue #131 Build 4). `preview` renders
 * the card text without sending; `test` posts it into the cohort's group
 * exactly like the standup-push job's own `GET`/`POST` split, and
 * deliberately ignores `standup_enabled` — the whole point of the Test
 * button is to try a standup before turning the schedule on. A `sendMessage`
 * failure (e.g. Telegram 429 rate-limiting a chat that was just posted to)
 * is caught here and reported as `{ok:false}`/502, the same shape
 * `webhook/route.ts` already uses for its own Telegram calls — an uncaught
 * throw here is a bare 500 with no JSON body, which the dashboard's fetch
 * can't parse.
 * `enable`/`disable` flip that flag through `SettingsService`, which is
 * `audit_logs`' second writer alongside `saveGroupChatId`.
 */
export async function POST(request: NextRequest) {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => undefined);
  const parsed = parseStandupRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  if (parsed.value.mode === "enable" || parsed.value.mode === "disable") {
    const saveResult = await deps.settingsService.saveStandupEnabled(
      caller,
      parsed.value.mode === "enable",
    );
    if (!saveResult.ok) {
      return NextResponse.json({ ok: false, error: saveResult.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, standupEnabled: parsed.value.mode === "enable" });
  }

  const model = buildQuoteModel();
  const now = new Date();

  if (parsed.value.mode === "preview") {
    const text = await buildStandupPushText({ service: deps.service, model }, caller.cohortId, now);
    return NextResponse.json({ ok: true, text });
  }

  const bot = new Bot(deps.botToken);
  attachAutoRetry(bot);
  try {
    const result = await sendStandupPush(
      { service: deps.service, model, bot, cohorts: deps.cohorts },
      caller.cohortId,
      now,
    );
    return NextResponse.json({ ok: true, sent: result.sent });
  } catch (error) {
    // Reported to the client as a generic message (below), so without this
    // the actual Telegram error (e.g. a 429) is invisible in Vercel's logs —
    // the exact gap that made the first "Failed to send test standup" report
    // impossible to diagnose from logs alone.
    console.error("standup test send failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to reach Telegram." },
      { status: 502 },
    );
  }
}
