-- Odyssey paths: the three (or so) five-year lives you could live, above the seasons. Each path has
-- a headline, a year-by-year sketch, four gauges you rate (resources, likability, confidence,
-- coherence) and the open questions a prototype would answer. Goals and backlog ideas point at a
-- path, so a path's progress is rolled up from real work: goals finished, goals running and their
-- pace, time logged. Safe to run more than once.

create table if not exists public.paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  headline text not null default '',
  why text not null default '',
  color text not null default '#5B8CFF',
  rank int not null default 0,
  horizon_years int not null default 5,
  -- One line per year, in order.
  years jsonb not null default '[]'::jsonb,
  -- {"resources": 1..5, "likability": 1..5, "confidence": 1..5, "coherence": 1..5}
  gauges jsonb not null default '{}'::jsonb,
  -- [{"on": "2026-10-26", "gauges": {...}}, ...] every time you re-rate (the 3-month checkpoint asks)
  gauge_log jsonb not null default '[]'::jsonb,
  -- [{"id", "text", "answer": "", "answered_at": null}] the questions a prototype would answer
  questions jsonb not null default '[]'::jsonb,
  -- [{"on": "2027-04-24", "text": "..."}] what each season taught you about this path (the retrospective asks)
  notes jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.paths enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'paths' and policyname = 'paths_owner') then
    create policy paths_owner on public.paths for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

alter table public.goals add column if not exists path_id uuid references public.paths(id) on delete set null;
alter table public.goal_ideas add column if not exists path_id uuid references public.paths(id) on delete set null;
create index if not exists goals_path_idx on public.goals (path_id);
create index if not exists goal_ideas_path_idx on public.goal_ideas (path_id);
