import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { Bot } from "grammy";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { parseStandupRequest } from "../../../../src/web/settingsRequests";
import { buildQuoteModel } from "../../../../src/nlp/quoteModel";
import { buildStandupPushText, sendStandupPush } from "../../../../src/jobs/standupPush";

/**
 * The Daily Standup (DSU) section's Preview/Test routes (issue #130). No
 * new standup logic — both call `src/jobs/standupPush.ts` unchanged — but
 * both need `model` (Build 0b) and, for `test`, `bot` and `cohorts`
 * (Build 0a/0c) that `DashboardDeps` didn't carry before this stage.
 * `preview` renders the card text without sending; `test` posts it into
 * the cohort's group, exactly like the standup-push job's own `GET`/`POST`
 * split.
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

  const model = buildQuoteModel();
  const now = new Date();

  if (parsed.value.mode === "preview") {
    const text = await buildStandupPushText({ service: deps.service, model }, caller.cohortId, now);
    return NextResponse.json({ ok: true, text });
  }

  const bot = new Bot(deps.botToken);
  const result = await sendStandupPush(
    { service: deps.service, model, bot, cohorts: deps.cohorts },
    caller.cohortId,
    now,
  );
  return NextResponse.json({ ok: true, sent: result.sent });
}
