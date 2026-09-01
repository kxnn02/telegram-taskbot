import "dotenv/config";
import { Bot } from "grammy";
import { createSupabaseClient } from "../storage/supabaseClient.js";
import { SupabaseTaskStore } from "../storage/supabaseTaskStore.js";
import { SupabaseRegistrationStore } from "../storage/supabaseRegistrationStore.js";
import { SupabaseOverdueNotificationStore } from "../storage/supabaseOverdueNotificationStore.js";
import { SupabaseCohortStore } from "../storage/supabaseCohortStore.js";
import { SupabaseRosterStore } from "../storage/supabaseRosterStore.js";
import { SupabaseAlertThrottleStore } from "../storage/supabaseAlertThrottleStore.js";
import { loadRosterFromStore } from "../config/roster.js";
import { TaskService } from "../service/taskService.js";
import { SystemClock } from "../domain/clock.js";
import type { NotificationJobDeps } from "./notificationJobs.js";

/**
 * Shared dependency-construction for every `/api/jobs/*` endpoint (mirrors
 * `api/telegram/webhook.ts`'s `buildDeps`, deliberately not unit-tested
 * itself for the same reason: it's a thin wire-up of real infra clients,
 * not logic — the only things worth testing are `INTERNAL_JOB_SECRET`/
 * `ACTIVE_COHORT_ID`/`BOT_TOKEN`/`MAINTAINER_USERNAME` being read from env,
 * which is exercised end-to-end by the fact this throws immediately if any
 * is missing).
 *
 * Not memoized at module scope the way the webhook's deps are — job
 * endpoints run far less often (hourly at most) than webhook deliveries, so
 * the cost of rebuilding this per invocation is negligible next to the
 * complexity of cache invalidation across four separate endpoint files.
 */
export interface JobEnv {
  activeCohortId: string;
  internalJobSecret: string;
  maintainerUsername: string;
}

export function loadJobEnv(): JobEnv {
  const activeCohortId = process.env.ACTIVE_COHORT_ID;
  if (!activeCohortId) throw new Error("ACTIVE_COHORT_ID is not set.");
  const internalJobSecret = process.env.INTERNAL_JOB_SECRET;
  if (!internalJobSecret) throw new Error("INTERNAL_JOB_SECRET is not set.");
  const maintainerUsername = process.env.MAINTAINER_USERNAME;
  if (!maintainerUsername) throw new Error("MAINTAINER_USERNAME is not set.");
  return { activeCohortId, internalJobSecret, maintainerUsername };
}

export async function buildNotificationJobDeps(): Promise<NotificationJobDeps> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not set.");

  const supabase = createSupabaseClient();
  const roster = await loadRosterFromStore(new SupabaseRosterStore(supabase));
  const bot = new Bot(token);
  await bot.init();

  const service = new TaskService(new SupabaseTaskStore(supabase), roster, new SystemClock());

  return {
    bot,
    registrations: new SupabaseRegistrationStore(supabase),
    service,
    roster,
    overdueNotifications: new SupabaseOverdueNotificationStore(supabase),
    cohorts: new SupabaseCohortStore(supabase),
    throttle: new SupabaseAlertThrottleStore(supabase),
  };
}
