import { loadRosterFromStore } from "../config/roster.js";
import { SystemClock } from "../domain/clock.js";
import type { Roster } from "../domain/roster.js";
import { TaskService } from "../service/taskService.js";
import { createSupabaseClient } from "../storage/supabaseClient.js";
import { SupabaseRosterStore } from "../storage/supabaseRosterStore.js";
import { SupabaseTaskStore } from "../storage/supabaseTaskStore.js";

/**
 * Shared dependency bag for the Next.js dashboard (Phase 6.1, issue #17):
 * the roster, a `TaskService` backed by the real Supabase task store, and
 * the env-derived config the login callback needs. Mirrors
 * `api/telegram/webhook.ts`'s `getDeps()` caching pattern — built once per
 * warm Lambda/dev-server instance (`loadRosterFromStore` and building the
 * Supabase client are the only network-touching steps), rather than
 * re-fetching the roster on every request. Cleared on failure so a later
 * request can retry after a transient error instead of failing forever
 * until a redeploy.
 *
 * This is a *new* module for the Next.js app — `src/web/index.ts` (the
 * existing Express dashboard's entrypoint) builds its own deps directly and
 * is left untouched.
 */
export interface DashboardDeps {
  botToken: string;
  botUsername: string;
  activeCohortId: string;
  sessionSecret: string;
  roster: Roster;
  service: TaskService;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

async function buildDashboardDeps(): Promise<DashboardDeps> {
  const botToken = requireEnv("BOT_TOKEN");
  const botUsername = requireEnv("BOT_USERNAME");
  const activeCohortId = requireEnv("ACTIVE_COHORT_ID");
  const sessionSecret = requireEnv("SESSION_SECRET");

  const supabase = createSupabaseClient();
  const roster = await loadRosterFromStore(new SupabaseRosterStore(supabase));
  const service = new TaskService(new SupabaseTaskStore(supabase), roster, new SystemClock());

  return { botToken, botUsername, activeCohortId, sessionSecret, roster, service };
}

let depsPromise: Promise<DashboardDeps> | undefined;

export function getDashboardDeps(): Promise<DashboardDeps> {
  if (!depsPromise) {
    depsPromise = buildDashboardDeps().catch((err) => {
      depsPromise = undefined;
      throw err;
    });
  }
  return depsPromise;
}
