-- Goal breakdown: each goal flows 6 months → 3 months → months → weeks → daily tasks.
-- The 6-month level is the goal itself; plan_steps holds the levels below it.
-- Daily tasks are ordinary actions (with schedules) linked to the step they were planned in,
-- so they show up on Today exactly like every other action.

create table public.plan_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  parent_id uuid references public.plan_steps(id) on delete cascade,
  level text not null check (level in ('quarter', 'month', 'week')),
  idx int not null default 0,
  title text not null,
  start_date date not null,
  end_date date not null,
  target_value numeric,
  target_note text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index plan_steps_by_goal on public.plan_steps (user_id, goal_id, level, start_date);

create trigger plan_steps_touch before update on public.plan_steps
  for each row execute function public.touch_updated_at();

alter table public.plan_steps enable row level security;
create policy plan_steps_owner on public.plan_steps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.actions
  add column step_id uuid references public.plan_steps(id) on delete set null;
