-- Six-Month Plan: initial schema
-- Every table is owned by one user (user_id defaults to the signed-in user)
-- and protected by row-level security. History is never overwritten:
-- targets and schedules get new rows with effective dates.

create extension if not exists pgcrypto;

-- ---------- Helpers ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Planning ----------
create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default '',
  timezone text not null default 'America/New_York',
  units text not null default 'lb' check (units in ('lb', 'kg')),
  -- minutes available per weekday, Monday first
  available_minutes int[] not null default '{150,150,150,150,150,180,60}',
  welcome_dismissed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  block_days int not null default 28 check (block_days between 7 and 56),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  type text not null check (type in ('number', 'practice', 'finish')),
  why text not null default '',
  done_means text not null default '',
  unit text,
  baseline_value numeric,
  baseline_date date,
  target_value numeric,
  target_date date,
  color text not null default '#0E6B61',
  measurement_type_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (plan_id, goal_id)
);

create table public.goal_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  target_date date not null,
  target_value numeric not null,
  effective_from date not null default current_date,
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null,
  due_date date not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Doing ----------
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  kind text not null default 'check' check (kind in ('check', 'count', 'minutes', 'workout', 'study')),
  planned_minutes int not null default 0 check (planned_minutes >= 0),
  planned_count int check (planned_count is null or planned_count > 0),
  min_label text not null default '',
  min_minutes int,
  min_count int,
  priority boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.action_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action_id uuid not null references public.actions(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (action_id, goal_id)
);

create table public.action_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action_id uuid not null references public.actions(id) on delete cascade,
  rule text not null check (rule in ('days', 'per_week')),
  -- ISO weekdays, 1 = Monday ... 7 = Sunday
  days int[] not null default '{}',
  per_week int check (per_week is null or per_week between 1 and 14),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action_id uuid references public.actions(id) on delete set null,
  week_start date not null,
  slot int not null default 0,
  date date, -- null = not placed on a day yet
  title text not null,
  priority boolean not null default false,
  planned_minutes int not null default 0,
  planned_count int,
  status text not null default 'planned'
    check (status in ('planned', 'done', 'partial', 'minimum', 'skipped', 'moved')),
  actual_minutes int,
  actual_count int,
  note text not null default '',
  obstacles text[] not null default '{}',
  origin text not null default 'scheduled' check (origin in ('scheduled', 'oneoff', 'unplanned')),
  source text not null default 'manual',
  moved_from uuid references public.sessions(id) on delete set null,
  logged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One session per action, week, origin and slot: generating a week twice (or on two
-- devices) never duplicates. One-off tasks have no action, so they never collide.
alter table public.sessions
  add constraint sessions_slot_unique unique (user_id, action_id, week_start, origin, slot);
create index sessions_by_date on public.sessions (user_id, date);
create index sessions_by_week on public.sessions (user_id, week_start);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  exercise text not null,
  set_no int not null,
  weight numeric,
  reps int,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Results ----------
create table public.measurement_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  unit text not null default '',
  cadence_days int not null default 7 check (cadence_days between 1 and 90),
  goal_id uuid references public.goals(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.goals
  add constraint goals_measurement_type_fk
  foreign key (measurement_type_id) references public.measurement_types(id) on delete set null;

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type_id uuid not null references public.measurement_types(id) on delete cascade,
  value numeric not null,
  measured_on date not null,
  source text not null default 'manual',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index measurements_by_type on public.measurements (user_id, type_id, measured_on);

-- ---------- Reviewing ----------
create table public.week_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  available_minutes int not null default 0,
  planned_minutes int not null default 0,
  saved_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('weekly', 'block', 'quarter', 'retro')),
  period_start date not null,
  period_end date not null,
  status text not null default 'done' check (status in ('draft', 'done')),
  went_well text not null default '',
  got_in_way text not null default '',
  change_next text not null default '',
  obstacles text[] not null default '{}',
  actions_done numeric not null default 0,
  actions_planned int not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.change_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity text not null,
  entity_id uuid not null,
  summary text not null,
  old_value jsonb,
  new_value jsonb,
  effective_from date not null,
  review_id uuid references public.reviews(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- updated_at triggers ----------
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger plans_touch before update on public.plans for each row execute function public.touch_updated_at();
create trigger goals_touch before update on public.goals for each row execute function public.touch_updated_at();
create trigger milestones_touch before update on public.milestones for each row execute function public.touch_updated_at();
create trigger actions_touch before update on public.actions for each row execute function public.touch_updated_at();
create trigger sessions_touch before update on public.sessions for each row execute function public.touch_updated_at();

-- ---------- Row-level security: only the owner sees and changes a row ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'plans', 'goals', 'plan_goals', 'goal_targets', 'milestones',
    'actions', 'action_goals', 'action_schedules', 'sessions', 'workout_sets',
    'measurement_types', 'measurements', 'week_plans', 'reviews', 'change_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t
    );
  end loop;
end;
$$;

-- ---------- Weekly review: one transaction ----------
-- Payload shape:
-- {
--   "review": { id, kind, period_start, period_end, went_well, got_in_way, change_next,
--               obstacles: [], actions_done, actions_planned },
--   "schedule_changes": [ { end_schedule_id, end_on, new_schedule: {id, action_id, rule, days, per_week, effective_from},
--                           summary, old_value, new_value } ],
--   "action_changes":   [ { action_id, min_label, min_minutes, min_count, summary, old_value, new_value } ],
--   "week_plan": { id, week_start, available_minutes, planned_minutes },
--   "sessions":  [ session rows for next week ],
--   "measurements": [ measurement rows ]
-- }
create or replace function public.complete_weekly_review(payload jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  r jsonb := payload -> 'review';
  review_id uuid := coalesce((r ->> 'id')::uuid, gen_random_uuid());
  item jsonb;
  ns jsonb;
begin
  insert into public.reviews (id, kind, period_start, period_end, status, went_well, got_in_way,
                              change_next, obstacles, actions_done, actions_planned, completed_at)
  values (
    review_id,
    r ->> 'kind',
    (r ->> 'period_start')::date,
    (r ->> 'period_end')::date,
    'done',
    coalesce(r ->> 'went_well', ''),
    coalesce(r ->> 'got_in_way', ''),
    coalesce(r ->> 'change_next', ''),
    coalesce(array(select jsonb_array_elements_text(r -> 'obstacles')), '{}'),
    coalesce((r ->> 'actions_done')::numeric, 0),
    coalesce((r ->> 'actions_planned')::int, 0),
    now()
  );

  for item in select * from jsonb_array_elements(coalesce(payload -> 'measurements', '[]'::jsonb)) loop
    insert into public.measurements (id, type_id, value, measured_on, source, note)
    values ((item ->> 'id')::uuid, (item ->> 'type_id')::uuid, (item ->> 'value')::numeric,
            (item ->> 'measured_on')::date, 'manual', coalesce(item ->> 'note', ''));
  end loop;

  for item in select * from jsonb_array_elements(coalesce(payload -> 'schedule_changes', '[]'::jsonb)) loop
    update public.action_schedules
       set effective_to = (item ->> 'end_on')::date
     where id = (item ->> 'end_schedule_id')::uuid;
    ns := item -> 'new_schedule';
    insert into public.action_schedules (id, action_id, rule, days, per_week, effective_from)
    values ((ns ->> 'id')::uuid, (ns ->> 'action_id')::uuid, ns ->> 'rule',
            coalesce(array(select (jsonb_array_elements_text(ns -> 'days'))::int), '{}'),
            (ns ->> 'per_week')::int, (ns ->> 'effective_from')::date);
    insert into public.change_log (entity, entity_id, summary, old_value, new_value, effective_from, review_id)
    values ('action_schedule', (ns ->> 'action_id')::uuid, item ->> 'summary',
            item -> 'old_value', item -> 'new_value', (ns ->> 'effective_from')::date, review_id);
  end loop;

  for item in select * from jsonb_array_elements(coalesce(payload -> 'action_changes', '[]'::jsonb)) loop
    update public.actions
       set min_label = coalesce(item ->> 'min_label', min_label),
           min_minutes = (item ->> 'min_minutes')::int,
           min_count = (item ->> 'min_count')::int
     where id = (item ->> 'action_id')::uuid;
    insert into public.change_log (entity, entity_id, summary, old_value, new_value, effective_from, review_id)
    values ('action', (item ->> 'action_id')::uuid, item ->> 'summary',
            item -> 'old_value', item -> 'new_value', current_date, review_id);
  end loop;

  if payload ? 'week_plan' then
    insert into public.week_plans (id, week_start, available_minutes, planned_minutes, saved_at)
    values ((payload -> 'week_plan' ->> 'id')::uuid,
            (payload -> 'week_plan' ->> 'week_start')::date,
            coalesce((payload -> 'week_plan' ->> 'available_minutes')::int, 0),
            coalesce((payload -> 'week_plan' ->> 'planned_minutes')::int, 0),
            now())
    on conflict (user_id, week_start) do update
      set available_minutes = excluded.available_minutes,
          planned_minutes = excluded.planned_minutes,
          saved_at = now();
  end if;

  for item in select * from jsonb_array_elements(coalesce(payload -> 'sessions', '[]'::jsonb)) loop
    insert into public.sessions (id, action_id, week_start, slot, date, title, priority,
                                 planned_minutes, planned_count, status, origin)
    values ((item ->> 'id')::uuid, (item ->> 'action_id')::uuid, (item ->> 'week_start')::date,
            coalesce((item ->> 'slot')::int, 0), (item ->> 'date')::date, item ->> 'title',
            coalesce((item ->> 'priority')::boolean, false),
            coalesce((item ->> 'planned_minutes')::int, 0), (item ->> 'planned_count')::int,
            'planned', coalesce(item ->> 'origin', 'scheduled'))
    on conflict (user_id, action_id, week_start, origin, slot)
    do update set date = excluded.date,
                  planned_minutes = excluded.planned_minutes,
                  planned_count = excluded.planned_count
      where public.sessions.status = 'planned';
  end loop;

  return review_id;
end;
$$;

grant execute on function public.complete_weekly_review(jsonb) to authenticated;

-- ---------- Private storage for photos and recordings (used in a later phase) ----------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments_owner_read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments_owner_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
