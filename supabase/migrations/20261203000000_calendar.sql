-- Calendars read into the app, one way (the app never writes to them).
-- calendar_feeds: each calendar's private iCal address ("Secret address in iCal format" in Google
-- Calendar). calendar_events: the events the server read from those feeds, recurring ones expanded
-- into dates; only the server (service role) writes them, so they always match the calendar.

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null default '',
  url text not null,
  color text not null default '#4285F4',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_feeds_user on public.calendar_feeds (user_id);
alter table public.calendar_feeds enable row level security;

drop policy if exists "own calendar feeds" on public.calendar_feeds;
create policy "own calendar feeds" on public.calendar_feeds
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feed_id uuid not null references public.calendar_feeds (id) on delete cascade,
  key text not null,
  title text not null default '',
  location text not null default '',
  all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feed_id, key)
);

create index if not exists calendar_events_user_start on public.calendar_events (user_id, starts_at);
create index if not exists calendar_events_user_date on public.calendar_events (user_id, start_date);
alter table public.calendar_events enable row level security;

-- Read-only for the person; the sync (service role) does the writing.
drop policy if exists "read own calendar events" on public.calendar_events;
create policy "read own calendar events" on public.calendar_events
  for select to authenticated using (user_id = (select auth.uid()));
