import "dotenv/config";
import { createBot } from "./createBot.js";
import { createSupabaseClient } from "../storage/supabaseClient.js";
import { SupabaseTaskStore } from "../storage/supabaseTaskStore.js";
import { SupabaseRegistrationStore } from "../storage/supabaseRegistrationStore.js";
import { SupabaseOverdueNotificationStore } from "../storage/supabaseOverdueNotificationStore.js";
import { SupabaseCohortStore } from "../storage/supabaseCohortStore.js";
import { SupabaseWizardStateStore } from "../storage/supabaseWizardStateStore.js";
import { SupabaseRosterStore } from "../storage/supabaseRosterStore.js";
import { loadRosterFromStore } from "../config/roster.js";
import { startScheduler } from "../notifications/scheduler.js";

/**
 * LOCAL-DEV-ONLY entrypoint (`npm run dev`). Runs the bot via long polling
 * in one always-on process, including the node-cron scheduler — the
 * opposite of the deployed shape. Vercel only picks up files under `/api`
 * (see `api/telegram/webhook.ts`), so this file never runs there; it exists
 * purely as a developer's own testing loop (ADR-0001/ADR-0004). Talks to
 * the same real Supabase project as production, same roster/cohort tables
 * included — there is no separate "local" data store as of this phase.
 */

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
  }

  const supabase = createSupabaseClient();
  const roster = await loadRosterFromStore(new SupabaseRosterStore(supabase));

  const { bot, service, registrations } = createBot({
    token,
    taskStore: new SupabaseTaskStore(supabase),
    registrationStore: new SupabaseRegistrationStore(supabase),
    wizardStateStore: new SupabaseWizardStateStore(supabase),
    roster,
    dashboardUrl:
      process.env.DASHBOARD_URL ?? "https://example.com/dashboard-coming-soon",
  });

  // Scheduled notifications (issue #2): due-date reminders, overdue crossing,
  // and the daily/weekly digests, all on Asia/Manila time (PRD §8). Phase 4
  // (issue #15) moves this to pg_cron; node-cron stays here for local dev
  // only until then (ADR-0007).
  const scheduler = startScheduler({
    bot,
    registrations,
    service,
    roster,
    overdueNotifications: new SupabaseOverdueNotificationStore(supabase),
    cohorts: new SupabaseCohortStore(supabase),
  });

  process.on("SIGINT", () => {
    scheduler.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    scheduler.stop();
    process.exit(0);
  });

  await bot.start();
  // eslint-disable-next-line no-console
  console.log("Bot started (local dev, long polling).");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
