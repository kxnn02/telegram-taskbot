import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDeps } from "../../../../../src/web/nextDashboardDeps";
import { handleTelegramLoginCallback } from "../../../../../src/web/telegramLoginHandler";
import { serializeCookie } from "../../../../../src/web/cookies";

/**
 * Next.js Route Handler adapter for the Telegram Login Widget's callback
 * (Phase 6.1, issue #17 — step 3). Deliberately thin, same split as
 * `api/telegram/webhook.ts` vs `webhookHandler.ts`: all the actual
 * verification/roster/cookie-signing logic lives in
 * `telegramLoginHandler.ts`'s `handleTelegramLoginCallback`, unit-tested
 * directly without needing a running Next server — this file just adapts a
 * real `NextRequest`/`NextResponse` to/from that function's plain shape.
 */

const SESSION_COOKIE = "session";

export async function GET(request: NextRequest) {
  const deps = await getDashboardDeps();

  const query: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    query[key] = value;
  }

  const result = handleTelegramLoginCallback(
    {
      botToken: deps.botToken,
      roster: deps.roster,
      activeCohortId: deps.activeCohortId,
      sessionSecret: deps.sessionSecret,
    },
    query,
  );

  if (!result.ok) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", result.message);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, result.cookieValue));
  return response;
}
