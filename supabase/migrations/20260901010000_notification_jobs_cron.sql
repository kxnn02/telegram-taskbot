-- SUPERSEDED IN PART by 20260901115000_job_endpoint_vault_config.sql.
-- The "REQUIRED MANUAL SETUP" block below cannot be carried out: Supabase's
-- `postgres` role is not a superuser, so `alter database ... set` on a
-- custom parameter fails with 42501 (issue #37). `call_job_endpoint` now
-- reads its configuration from Supabase Vault instead. The schedules and
-- times defined here are unchanged and still current.
--
-- pg_cron + pg_net schedules for the four notification-job HTTP endpoints
-- (ADR-0007, issue #15): hourly overdue-crossing check, daily due-tomorrow
-- reminder, daily digest, weekly digest. Each schedule fires an
-- authenticated POST to this deployment's `/api/jobs/*` endpoint via
-- `pg_net`'s `net.http_post` (fire-and-forget from Postgres's side — the
-- response isn't awaited synchronously here, matching how `pg_net` is
-- designed to be used from `pg_cron`).
--
-- Schedule times are converted from the Asia/Manila times already used by
-- the old node-cron scheduler (src/notifications/scheduler.ts) to their
-- UTC equivalent, the same way 20260831090000_wizard_state_cleanup_cron.sql
-- converts 11am Manila to 3am UTC: Asia/Manila is UTC+8 year-round (no
-- DST), so "X am Manila" = "(X-8) am UTC" on the same calendar day for any
-- X >= 8.
--   - overdue-crossing: hourly. An hourly cadence repeats every hour
--     regardless of timezone, so no conversion is needed — '0 * * * *' is
--     identical in UTC and Manila.
--   - due-soon reminder: daily 9am Manila -> 1am UTC.
--   - daily digest: daily 10am Manila -> 2am UTC.
--   - weekly digest: Monday 10am Manila -> Monday 2am UTC (2am is still
--     within the same Monday in UTC, so no day-of-week shift).
--
-- REQUIRED MANUAL SETUP (cannot be safely committed to git — this migration
-- intentionally does not hardcode a real URL or secret): before these
-- schedules can actually reach a deployment, run once per Supabase project
-- (via the Supabase SQL editor or `supabase db execute`), substituting the
-- real deployed Vercel URL for this branch/environment and the same value
-- configured as `INTERNAL_JOB_SECRET` in that deployment's env vars:
--
--   alter database postgres set app.settings.jobs_base_url = 'https://<your-deployment>.vercel.app';
--   alter database postgres set app.settings.internal_job_secret = '<same value as INTERNAL_JOB_SECRET>';
--
-- Production and the dry-run branch each need this run once against
-- whichever value applies at the time (both currently point at the same
-- shared Supabase project, so these settings are effectively global to
-- that project — if production and dry-run ever needed genuinely
-- different base URLs simultaneously, this would need per-cohort settings
-- instead of one pair of database-level GUCs; not needed today since the
-- dry-run branch's stable branch-domain URL is what's configured here in
-- practice, swapped for production's URL at cutover time).
create extension if not exists pg_net;

create or replace function call_job_endpoint(p_path text)
returns void
language plpgsql
as $$
begin
  perform net.http_post(
    url := current_setting('app.settings.jobs_base_url') || p_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-job-secret', current_setting('app.settings.internal_job_secret')
    ),
    body := '{}'::jsonb
  );
end;
$$;

select cron.schedule(
  'job-overdue-crossing-check',
  '0 * * * *', -- hourly (same in UTC and Manila)
  $$ select call_job_endpoint('/api/jobs/overdue-crossing') $$
);

select cron.schedule(
  'job-due-soon-reminder',
  '0 1 * * *', -- daily, 1am UTC = 9am Asia/Manila
  $$ select call_job_endpoint('/api/jobs/due-soon-reminder') $$
);

select cron.schedule(
  'job-daily-digest',
  '0 2 * * *', -- daily, 2am UTC = 10am Asia/Manila
  $$ select call_job_endpoint('/api/jobs/daily-digest') $$
);

select cron.schedule(
  'job-weekly-digest',
  '0 2 * * 1', -- Monday, 2am UTC = 10am Asia/Manila
  $$ select call_job_endpoint('/api/jobs/weekly-digest') $$
);
