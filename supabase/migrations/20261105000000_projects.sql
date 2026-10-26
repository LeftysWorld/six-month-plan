-- Projects under goals. Safe to run more than once.
--
-- A six-month goal is an outcome; the courses, exams and builds that get you there are projects
-- (temporary work with a finish line). A project is a goal row with parent_id set, so it keeps
-- everything a goal has: tasks, milestones, photos, change history.
--
--  * goals: parent_id, start/target/deadline dates (fixed or flexible), finish-to-start
--    dependencies, started/dropped, baseline dates, a short brief (scope in/out, definition of
--    done, pre-mortem, kill criteria), close-out answers and a benefits check-back.
--  * milestones: created_at (a burn-up's scope line) and deliverable (a note or link).
--  * raid_items: risks, assumptions, issues and decisions for a project or a goal.
--  * reviews: project_notes (weekly status lines) and project_decisions (3-month stage gate).
--  * profiles: project_wip_limit (how many projects can be active at once; empty means 4).

alter table public.goals add column if not exists parent_id uuid references public.goals(id) on delete cascade;
alter table public.goals add column if not exists start_date date;
alter table public.goals add column if not exists deadline date;
alter table public.goals add column if not exists fixed_start boolean not null default false;
alter table public.goals add column if not exists fixed_deadline boolean not null default false;
alter table public.goals add column if not exists depends_on uuid[] not null default '{}';
alter table public.goals add column if not exists started_at timestamptz;
alter table public.goals add column if not exists dropped_at timestamptz;
alter table public.goals add column if not exists baseline_start date;
alter table public.goals add column if not exists baseline_end date;
alter table public.goals add column if not exists scope_in text not null default '';
alter table public.goals add column if not exists scope_out text not null default '';
alter table public.goals add column if not exists dod jsonb not null default '[]'::jsonb;
alter table public.goals add column if not exists premortem text not null default '';
alter table public.goals add column if not exists kill_criteria text not null default '';
alter table public.goals add column if not exists closeout jsonb;
alter table public.goals add column if not exists benefit_question text not null default '';
alter table public.goals add column if not exists benefit_check_on date;
alter table public.goals add column if not exists benefit_result text not null default '';
create index if not exists goals_parent_idx on public.goals (parent_id);

alter table public.milestones add column if not exists created_at timestamptz not null default now();
alter table public.milestones add column if not exists deliverable text not null default '';

create table if not exists public.raid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  kind text not null check (kind in ('risk', 'assumption', 'issue', 'decision')),
  title text not null default '',
  detail text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists raid_items_goal_idx on public.raid_items (goal_id);

alter table public.raid_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'raid_items' and policyname = 'raid_items_owner') then
    create policy raid_items_owner on public.raid_items for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

alter table public.reviews add column if not exists project_notes jsonb not null default '[]'::jsonb;
alter table public.reviews add column if not exists project_decisions jsonb not null default '[]'::jsonb;

alter table public.profiles add column if not exists project_wip_limit int;
