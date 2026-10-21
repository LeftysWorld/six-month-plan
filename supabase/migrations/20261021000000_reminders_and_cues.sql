-- Reminders and habit cues.
-- * actions.cue: an "after ___, at ___" habit cue shown with the task.
-- * profiles: morning reminder time, evening "streak saver" switch, and a secret
--   token for the read-only calendar feed (supabase/functions/calendar).
-- * push_subscriptions: one row per browser/phone that turned on reminders.
--   The send-reminders Edge Function reads these with the service role.
-- Safe to run more than once.

alter table public.actions add column if not exists cue text not null default '';

alter table public.profiles add column if not exists reminder_time time not null default '08:00';
alter table public.profiles add column if not exists evening_reminder boolean not null default true;
alter table public.profiles add column if not exists calendar_token uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_calendar_token_key' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_calendar_token_key unique (calendar_token);
  end if;
end;
$$;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_morning_on date,
  last_evening_on date
);
create index if not exists push_subscriptions_by_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_owner'
  ) then
    create policy push_subscriptions_owner on public.push_subscriptions for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;
