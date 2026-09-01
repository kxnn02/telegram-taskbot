-- Raises the pg_net timeout on the notification-job calls from its 5s
-- default to 30s. Issue #37.
--
-- The first real invocation of `call_job_endpoint` returned
-- `Timeout of 5000 ms reached` in `net._http_response`, yet the job had in
-- fact run to completion server-side -- `alert_throttle` showed the daily
-- digest's claim for that date. pg_net had simply stopped waiting for a
-- response that was still on its way.
--
-- 5s is not a realistic budget for these endpoints. They run hourly at
-- most, so a Vercel function is almost always cold when one arrives, and
-- each job then does several Supabase round trips plus one or more
-- Telegram API calls before responding.
--
-- Why this matters beyond tidiness: `net.http_post` is asynchronous, so
-- the cron command returns as soon as the request is *queued* and
-- `cron.job_run_details` records "succeeded" no matter what the HTTP
-- response turns out to be. `net._http_response` is therefore the only
-- place the real outcome is visible, and a premature timeout destroys
-- exactly that evidence -- leaving a job that worked and a job that 500'd
-- looking identical. The longer timeout costs nothing (the wait happens in
-- pg_net's background worker, not in the cron job) and buys back the one
-- signal that distinguishes them.
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
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
