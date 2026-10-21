-- Schedule the send-reminders Edge Function every 15 minutes.
-- Paste into Supabase → SQL Editor and run once (safe to run again to change values).
--
-- Before running, replace the two placeholders below:
--   YOUR-PROJECT-REF  → from Project Settings → General (the xxxx in https://xxxx.supabase.co)
--   YOUR-CRON-SECRET  → the same value you set with: supabase secrets set CRON_SECRET=...
--
-- The URL and secret are kept in Supabase Vault (encrypted), not in the job text.

create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Vault is enabled by default on Supabase projects; this is a no-op if it already is.
create extension if not exists supabase_vault;

do $$
declare
  v_url text := 'https://YOUR-PROJECT-REF.supabase.co';
  v_secret text := 'YOUR-CRON-SECRET';
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'reminders_project_url';
  if v_id is null then
    perform vault.create_secret(v_url, 'reminders_project_url', 'Project URL for the send-reminders job');
  else
    perform vault.update_secret(v_id, v_url);
  end if;

  select id into v_id from vault.secrets where name = 'reminders_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'reminders_cron_secret', 'CRON_SECRET for the send-reminders job');
  else
    perform vault.update_secret(v_id, v_secret);
  end if;
end;
$$;

-- Scheduling again with the same name replaces the existing job.
select cron.schedule(
  'send-reminders',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_project_url')
           || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- Check it:     select * from cron.job;
-- Recent runs:  select * from cron.job_run_details order by start_time desc limit 10;
-- Responses:    select id, status_code, content from net._http_response order by created desc limit 10;
-- Stop it:      select cron.unschedule('send-reminders');
