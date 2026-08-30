import "dotenv/config";
import { createBot } from "./createBot.js";
import { OverdueNotificationRepository } from "../db/overdueNotificationRepository.js";
import { startScheduler } from "../notifications/scheduler.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
}

const { bot, db, service, roster, registrations } = createBot({
  token,
  dbPath: process.env.DATABASE_PATH ?? "./data/taskbot.sqlite",
  rosterPath: process.env.ROSTER_PATH ?? "roster.config.json",
  dashboardUrl:
    process.env.DASHBOARD_URL ?? "https://example.com/dashboard-coming-soon",
});

// Scheduled notifications (issue #2): due-date reminders, overdue crossing,
// and the daily/weekly digests, all on Asia/Manila time (PRD §8).
const scheduler = startScheduler({
  bot,
  registrations,
  service,
  roster,
  overdueNotifications: new OverdueNotificationRepository(db),
  groupChatId: process.env.GROUP_CHAT_ID || undefined,
});

process.on("SIGINT", () => {
  scheduler.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  scheduler.stop();
  process.exit(0);
});

bot.start();
// eslint-disable-next-line no-console
console.log("Bot started.");
