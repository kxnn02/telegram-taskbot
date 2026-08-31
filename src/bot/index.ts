import "dotenv/config";
import { createBot } from "./createBot.js";
import { createSupabaseClient } from "../storage/supabaseClient.js";
import { SupabaseTaskStore } from "../storage/supabaseTaskStore.js";
import { SupabaseRegistrationStore } from "../storage/supabaseRegistrationStore.js";
import { SupabaseOverdueNotificationStore } from "../storage/supabaseOverdueNotificationStore.js";
import { startScheduler } from "../notifications/scheduler.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
}

const supabase = createSupabaseClient();

const { bot, service, roster, registrations } = createBot({
  token,
  taskStore: new SupabaseTaskStore(supabase),
  registrationStore: new SupabaseRegistrationStore(supabase),
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
  overdueNotifications: new SupabaseOverdueNotificationStore(supabase),
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
