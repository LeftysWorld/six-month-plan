-- Workout coach: the data the workout history report and the coach agent need.
--
-- 1. workout_plan_versions: every version of every workout's plan, with the day it took effect.
--    A trigger on actions records a new version whenever a workout's plan changes, from the app,
--    from SQL or from anywhere else, so nothing has to remember to log it. Existing plans get one
--    starting version here.
-- 2. workout_sets.rir and workout_sets.pain: how many more reps you had in you (0–5, optional) and
--    whether the exercise hurt.
-- 3. workout_reports: coach reports written by the agent (through the workout-agent Edge Function),
--    with your verdict on each (applied / partly / declined) and a note.
-- 4. profiles.coach_share_bodyweight: whether the history report (and so the agent) sees your
--    weekly body weight. On by default; Settings → Workout coach turns it off.
--
-- Safe to run twice.

-- ---------- 1. Plan history ----------
create table if not exists public.workout_plan_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action_id uuid not null references public.actions(id) on delete cascade,
  plan jsonb not null,
  details text not null default '',
  effective_on date not null,
  -- 'app' (any edit after this migration), 'backfill' (the plan as it stood when history began)
  source text not null default 'app',
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists workout_plan_versions_action_idx on public.workout_plan_versions (action_id, effective_on);

alter table public.workout_plan_versions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_plan_versions' and policyname = 'workout_plan_versions_owner') then
    create policy workout_plan_versions_owner on public.workout_plan_versions for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

-- A new version whenever a workout's plan is set or changes. The day is today in your time zone.
create or replace function public.record_workout_plan_version()
returns trigger
language plpgsql
security invoker
as $$
declare
  tz text;
begin
  if new.workout_plan is null or jsonb_typeof(new.workout_plan) <> 'array' or jsonb_array_length(new.workout_plan) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.workout_plan is not distinct from old.workout_plan then
    return new;
  end if;
  select timezone into tz from public.profiles where user_id = new.user_id;
  insert into public.workout_plan_versions (user_id, action_id, plan, details, effective_on, source)
  values (new.user_id, new.id, new.workout_plan, coalesce(new.details, ''),
          (now() at time zone coalesce(nullif(tz, ''), 'UTC'))::date, 'app');
  return new;
end;
$$;

drop trigger if exists actions_workout_plan_version on public.actions;
create trigger actions_workout_plan_version
  after insert or update of workout_plan on public.actions
  for each row execute function public.record_workout_plan_version();

-- The plans you have now become each workout's first version, dated from when its schedule began.
insert into public.workout_plan_versions (user_id, action_id, plan, details, effective_on, source, reason)
select a.user_id, a.id, a.workout_plan, coalesce(a.details, ''),
       coalesce((select min(s.effective_from) from public.action_schedules s where s.action_id = a.id), a.created_at::date),
       'backfill', 'The plan as it stood when plan history began'
from public.actions a
where a.workout_plan is not null
  and jsonb_typeof(a.workout_plan) = 'array'
  and jsonb_array_length(a.workout_plan) > 0
  and not exists (select 1 from public.workout_plan_versions v where v.action_id = a.id);

-- ---------- 2. Effort and pain per set ----------
alter table public.workout_sets add column if not exists rir smallint;
alter table public.workout_sets add column if not exists pain boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workout_sets_rir_range') then
    alter table public.workout_sets add constraint workout_sets_rir_range check (rir is null or (rir >= 0 and rir <= 5));
  end if;
end;
$$;

-- ---------- 3. Coach reports ----------
create table if not exists public.workout_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'coach' check (kind in ('coach')),
  -- The snapshot the report was made from.
  as_of date not null,
  months int not null default 6,
  schema_version text not null default '1',
  snapshot_hash text not null default '',
  -- The report as you read it (Markdown), and the decision as data.
  content_md text not null default '',
  decision jsonb not null default '{}'::jsonb,
  recommendation text not null default 'hold' check (recommendation in ('hold', 'change', 'none')),
  change_level smallint not null default 0 check (change_level between 0 and 6),
  -- What made it, so any report can be reproduced.
  model text not null default '',
  prompt_version text not null default '',
  -- Your verdict. Null until you mark it; the history report infers one from your plan history meanwhile.
  user_status text check (user_status is null or user_status in ('applied', 'partly', 'declined')),
  user_note text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists workout_reports_one_per_day on public.workout_reports (user_id, kind, as_of);

alter table public.workout_reports enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_reports' and policyname = 'workout_reports_owner') then
    create policy workout_reports_owner on public.workout_reports for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

-- ---------- 4. Body weight in the report ----------
alter table public.profiles add column if not exists coach_share_bodyweight boolean not null default true;

notify pgrst, 'reload schema';
