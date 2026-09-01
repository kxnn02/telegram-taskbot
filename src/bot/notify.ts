import type { Bot, InlineKeyboard } from "grammy";
import { normalizeUsername } from "../domain/roster.js";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";

/**
 * Sends a proactive DM to a roster username, per PRD §8. Silently no-ops if
 * that person has never run /start — Telegram can never be DM'd without a
 * prior message from the recipient, which is exactly why registration is
 * required (PRD §7/§12). This is deliberately "best effort, never throws":
 * a notification failure should never break the mutation that triggered it.
 * Returns whether a message was actually sent.
 */
export async function notifyUser(
  bot: Bot,
  registrations: RegistrationStorePort,
  username: string,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<boolean> {
  try {
    const telegramId = await registrations.findTelegramId(username);
    if (!telegramId) return false;
    await bot.api.sendMessage(telegramId, text, {
      reply_markup: keyboard,
    });
    return true;
  } catch {
    // Best-effort: e.g. the user blocked the bot, or the lookup itself
    // failed. Never let a notification failure surface as an error to
    // whoever triggered the mutation.
    return false;
  }
}

/**
 * Notification policy for a status change (issue #27/#29, replacing the
 * submit/approve/revise-specific notify calls the old review-gate commands
 * used): DM the assignee and the task's creator, skipping whoever performed
 * the change, and never sending the same person two DMs for one event —
 * covers the case where the assignee and the creator are the same person
 * (a self-assigned task) as well as the actor being either of them.
 */
export async function notifyStatusChange(
  bot: Bot,
  registrations: RegistrationStorePort,
  task: { assigneeUsername: string; assignedByUsername: string },
  actorUsername: string,
  text: string,
): Promise<void> {
  const recipients = new Set([
    normalizeUsername(task.assigneeUsername),
    normalizeUsername(task.assignedByUsername),
  ]);
  recipients.delete(normalizeUsername(actorUsername));
  for (const username of recipients) {
    await notifyUser(bot, registrations, username, text);
  }
}
