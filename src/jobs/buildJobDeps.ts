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
import type { RosterReconciliationDeps } from "./rosterReconciliation.js";
import type { NotifierBot } from "../notifications/scheduler.js";
import type { SetupFailureReporter } from "./jobEndpoint.js";
import { notifyJobFailure } from "./notifyJobFailure.js";

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

/** Only the `ACTIVE_COHORT_ID`/`MAINTAINER_USERNAME` env vars, for the two
 * Vercel-Cron-triggered endpoints that need self-DM-on-error but nothing
 * else notification-job-shaped (no roster/TaskService — `keep-alive` and
 * `weekly-backup` don't touch cohort task data). */
export function loadErrorReportingEnv(): { activeCohortId: string; maintainerUsername: string } {
  const activeCohortId = process.env.ACTIVE_COHORT_ID;
  if (!activeCohortId) throw new Error("ACTIVE_COHORT_ID is not set.");
  const maintainerUsername = process.env.MAINTAINER_USERNAME;
  if (!maintainerUsername) throw new Error("MAINTAINER_USERNAME is not set.");
  return { activeCohortId, maintainerUsername };
}

export interface ErrorReportingDeps {
  bot: NotifierBot;
  registrations: ReturnType<typeof buildRegistrationsAndThrottle>["registrations"];
  throttle: ReturnType<typeof buildRegistrationsAndThrottle>["throttle"];
}

function buildRegistrationsAndThrottle(supabase: ReturnType<typeof createSupabaseClient>) {
  return {
    registrations: new SupabaseRegistrationStore(supabase),
    throttle: new SupabaseAlertThrottleStore(supabase),
  };
}

/** Builds just enough (`bot`, `registrations`, `throttle`) for
 * `notifyJobFailure` to work, for endpoints that don't otherwise need a
 * full `NotificationJobDeps` (`keep-alive`, `weekly-backup`). Reuses the
 * one Supabase client the caller already built for its own work, rather
 * than opening a second connection. */
export async function buildErrorReportingDeps(
  supabase: ReturnType<typeof createSupabaseClient>,
): Promise<ErrorReportingDeps> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not set.");
  const bot = new Bot(token);
  await bot.init();
  return { bot, ...buildRegistrationsAndThrottle(supabase) };
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

/**
 * Dependencies for the roster-reconciliation job (R5/#90). No `TaskService`
 * needed here (unlike `buildNotificationJobDeps`) — this job never touches
 * task data, only roster/registration/group-membership state — so this is
 * a separate, smaller builder rather than reusing `NotificationJobDeps`.
 * `api` is grammy's `bot.api`, which already satisfies `MembershipApi`
 * (`getChatMember(chatId, userId)`) without any adapting.
 */
export async function buildRosterReconciliationDeps(): Promise<RosterReconciliationDeps> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not set.");

  const supabase = createSupabaseClient();
  const roster = await loadRosterFromStore(new SupabaseRosterStore(supabase));
  const bot = new Bot(token);
  await bot.init();

  return {
    bot,
    api: bot.api,
    registrations: new SupabaseRegistrationStore(supabase),
    roster,
    cohorts: new SupabaseCohortStore(supabase),
    throttle: new SupabaseAlertThrottleStore(supabase),
  };
}

/**
 * The `SetupFailureReporter` the two Vercel-Cron endpoints hand to
 * `guardSetup` (issue #43). Infra wire-up, so untested here for the same
 * reason as the rest of this file.
 *
 * `report` rebuilds the reporting path from scratch rather than receiving it,
 * because the whole point is that it is called when the caller's own attempt
 * to build that path threw. It may therefore throw again — `guardSetup`
 * expects that and swallows it.
 *
 * `log` is what actually closes the issue's silent-failure hole. A DM needs
 * `BOT_TOKEN`, the Supabase credentials and `MAINTAINER_USERNAME`, which is
 * the same config whose absence brings us here, so for that subset of
 * failures Telegram is unreachable by construction and this line is the only
 * record that anything happened.
 */
export function makeSetupReporter(): SetupFailureReporter {
  return {
    log(jobName, error) {
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(
        `[job:${jobName}] setup failed before error reporting was available: ${message}`,
      );
    },
    async report(jobName, error) {
      const env = loadErrorReportingEnv();
      const client = createSupabaseClient();
      const deps = await buildErrorReportingDeps(client);
      await notifyJobFailure(
        {
          bot: deps.bot,
          registrations: deps.registrations,
          throttle: deps.throttle,
          maintainerUsername: env.maintainerUsername,
        },
        jobName,
        env.activeCohortId,
        error,
      );
    },
  };
}

