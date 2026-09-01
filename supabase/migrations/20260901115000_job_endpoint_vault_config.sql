-- Reconfigures call_job_endpoint (20260901010000_notification_jobs_cron.sql)
-- to read its URL and secrets from Supabase Vault, and to get past Vercel
-- SSO. Issue #37. The four schedules themselves are unchanged -- they call
-- this function by name, so replacing the function is the whole fix.
--
-- Two independent reasons the original could never have delivered a
-- request, both found the first time it was applied:
--
-- 1. CONFIGURATION CANNOT LIVE IN DATABASE SETTINGS ON SUPABASE. The
--    original read `app.settings.jobs_base_url` and
--    `app.settings.internal_job_secret`, to be installed once per project
--    with `alter database postgres set ...`. Supabase's `postgres` role
--    owns the database but is NOT a superuser, and Postgres requires
--    superuser to set a *customized* parameter -- one whose name contains
--    a dot and belongs to no loaded extension -- at either database or
--    role level. Both `alter database postgres set app.settings.x` and
--    `alter role postgres set app.settings.x` fail with `42501: permission
--    denied to set parameter`, verified against this project. So every
--    tick would have thrown on `current_setting()` before reaching pg_net.
--    `supabase_vault` is the supported alternative.
--
-- 2. EVERY *.vercel.app URL IS BEHIND VERCEL SSO. This project has Vercel
--    Authentication enabled with scope "all deployments except custom
--    domains", so an unauthenticated POST to the dry-run branch domain --
--    or the production alias -- answers a 401 SSO challenge that never
--    reaches the route handler. pg_net cannot complete an SSO flow, so the
--    four schedules would have fired exactly on time and been rejected at
--    the edge, which from Postgres's side is indistinguishable from the
--    job having run. The project already has a Protection Bypass for
--    Automation secret, which the Telegram webhook depends on for the same
--    reason; the bypass header is sent here for the same purpose.
--
-- REQUIRED MANUAL SETUP, once per Supabase project -- replaces the
-- `alter database` block in 20260901010000. Run in the Supabase SQL editor,
-- substituting real values (this migration hardcodes neither URL nor
-- secret):
--
--   select vault.create_secret(
--     'https://<your-deployment>.vercel.app', 'jobs_base_url',
--     'Base URL the pg_cron notification jobs POST to');
--
--   select vault.create_secret(
--     '<same value as the deployment''s INTERNAL_JOB_SECRET env var>',
--     'internal_job_secret',
--     'Shared secret the /api/jobs/* endpoints check via x-internal-job-secret');
--
--   select vault.create_secret(
--     '<the project''s Protection Bypass for Automation secret>',
--     'vercel_protection_bypass',
--     'Lets pg_net past Vercel SSO on *.vercel.app deployment URLs');
--
-- To change one later use `vault.update_secret(id, ...)` rather than
-- creating a second row under the same name -- the lookups below expect a
-- single row per name.
--
-- `jobs_base_url` is not itself a secret, but it lives alongside the other
-- two so there is one lookup mechanism rather than two.
--
-- `vercel_protection_bypass` is deliberately OPTIONAL: absent or empty, the
-- header is omitted entirely, so repointing `jobs_base_url` at a custom
-- domain (which Vercel exempts from protection) needs no bypass and no
-- further migration.
--
-- Production and the dry-run branch share this one Supabase project, so
-- these secrets are global to it: whichever deployment `jobs_base_url`
-- names receives every job. Today that is the dry-run branch's stable
-- branch-domain URL; it is repointed at production at cutover (#17).
create extension if not exists supabase_vault with schema vault;

create or replace function call_job_endpoint(p_path text)
returns void
language plpgsql
as $$
declare
  v_base text;
  v_secret text;
  v_bypass text;
  v_headers jsonb;
begin
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'jobs_base_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'internal_job_secret';
  select decrypted_secret into v_bypass
    from vault.decrypted_secrets where name = 'vercel_protection_bypass';

  -- Fail loudly rather than POST to "null/api/jobs/..." or with no auth
  -- header: a job that errors is visible in cron.job_run_details, whereas
  -- one that quietly posts garbage looks like a success from here.
  if coalesce(v_base, '') = '' then
    raise exception 'vault secret "jobs_base_url" is missing or empty; see 20260901115000_job_endpoint_vault_config.sql';
  end if;
  if coalesce(v_secret, '') = '' then
    raise exception 'vault secret "internal_job_secret" is missing or empty; see 20260901115000_job_endpoint_vault_config.sql';
  end if;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-job-secret', v_secret
  );

  -- Only present when the target is an SSO-protected Vercel URL.
  if coalesce(v_bypass, '') <> '' then
    v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;

  perform net.http_post(
    url := v_base || p_path,
    headers := v_headers,
    body := '{}'::jsonb
  );
end;
$$;
