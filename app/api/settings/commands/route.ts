import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Bot } from "grammy";
import { getDashboardDeps } from "../../../../src/web/nextDashboardDeps";
import { resolveCallerFromCookie, SESSION_COOKIE } from "../../../../src/web/requireDashboardSession";
import { registerBotCommands, BOT_COMMANDS } from "../../../../src/bot/createBot";

/**
 * The Bot Connection section's "Sync Bot Commands" button (issue #130) —
 * an idempotent `setMyCommands` call, open to any signed-in cohort member
 * (unlike Register, this can't take the bot offline).
 */
export async function POST() {
  const deps = await getDashboardDeps();
  const cookieStore = await cookies();
  const caller = resolveCallerFromCookie(cookieStore.get(SESSION_COOKIE)?.value, deps.sessionSecret);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  try {
    const bot = new Bot(deps.botToken);
    await registerBotCommands(bot);
    return NextResponse.json({ ok: true, count: BOT_COMMANDS.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to reach Telegram." },
      { status: 502 },
    );
  }
}
