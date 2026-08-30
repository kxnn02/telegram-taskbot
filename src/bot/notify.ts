import type { Bot, InlineKeyboard } from "grammy";
import type { RegistrationRepository } from "../db/registrationRepository.js";

/**
 * Sends a proactive DM to a roster username, per PRD §8. Silently no-ops if
 * that person has never run /start — Telegram can never be DM'd without a
 * prior message from the recipient, which is exactly why registration is
 * required (PRD §7/§12). This is deliberately "best effort, never throws":
 * a notification failure should never break the mutation that triggered it.
 */
export async function notifyUser(
  bot: Bot,
  registrations: RegistrationRepository,
  username: string,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  const telegramId = registrations.findTelegramId(username);
  if (!telegramId) return;
  try {
    await bot.api.sendMessage(telegramId, text, {
      reply_markup: keyboard,
    });
  } catch {
    // Best-effort: e.g. the user blocked the bot. Never let a notification
    // failure surface as an error to whoever triggered the mutation.
  }
}
