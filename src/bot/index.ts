import "dotenv/config";
import { createBot } from "./createBot.js";
import { createSupabaseClient } from "../storage/supabaseClient.js";
import { SupabaseTaskStore } from "../storage/supabaseTaskStore.js";
import { SupabaseRegistrationStore } from "../storage/supabaseRegistrationStore.js";
import { SupabaseWizardStateStore } from "../storage/supabaseWizardStateStore.js";
import { SupabaseRosterStore } from "../storage/supabaseRosterStore.js";
import { loadRosterFromStore } from "../config/roster.js";

/**
 * LOCAL-DEV-ONLY entrypoint (`npm run dev`). Runs the bot via long polling
 * in one always-on process — the opposite of the deployed shape. Vercel
 * only picks up files under `/api` (see `api/telegram/webhook.ts`), so this
 * file never runs there; it exists purely as a developer's own testing loop
 * (ADR-0001/ADR-0004). Talks to the same real Supabase project as
 * production, same roster/cohort tables included — there is no separate
 * "local" data store as of this phase.
 *
 * Scheduled notifications (issue #2: due-date reminders, overdue crossing,
 * daily/weekly digests) no longer run from here — Phase 4 (issue #15/
 * ADR-0007) moved them to Supabase `pg_cron` + `pg_net` calling the
 * `/api/jobs/*` endpoints, so there's nothing left for this local-dev
 * entrypoint to start/stop.
 */

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
  }

  const activeCohortId = process.env.ACTIVE_COHORT_ID;
  if (!activeCohortId) {
    throw new Error("ACTIVE_COHORT_ID is not set. Copy .env.example to .env and fill it in.");
  }

  const supabase = createSupabaseClient();
  const roster = await loadRosterFromStore(new SupabaseRosterStore(supabase));

  const { bot } = createBot({
    token,
    taskStore: new SupabaseTaskStore(supabase),
    registrationStore: new SupabaseRegistrationStore(supabase),
    wizardStateStore: new SupabaseWizardStateStore(supabase),
    roster,
    activeCohortId,
    dashboardUrl:
      process.env.DASHBOARD_URL ?? "https://example.com/dashboard-coming-soon",
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
