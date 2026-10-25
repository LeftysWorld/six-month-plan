-- Goal backlog: ideas for goals, ordered by importance, Kanban style. Safe to run more than once.
--   backlog   → written down, waiting, in order of importance (rank: lower = more important)
--   selected  → "Selected for next commitment" (the app keeps this to 3)
--   started   → became a goal (goal_id points at it)
--   discarded → let go (kept so it can be restored)

create table if not exists public.goal_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  note text not null default '',
  status text not null default 'backlog' check (status in ('backlog', 'selected', 'started', 'discarded')),
  rank double precision not null default 0,
  goal_id uuid references public.goals(id) on delete set null,
  created_at timestamptz not null default now(),
  selected_at timestamptz,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists goal_ideas_by_status on public.goal_ideas (user_id, status, rank);

drop trigger if exists goal_ideas_touch on public.goal_ideas;
create trigger goal_ideas_touch before update on public.goal_ideas
  for each row execute function public.touch_updated_at();

alter table public.goal_ideas enable row level security;
drop policy if exists goal_ideas_owner on public.goal_ideas;
create policy goal_ideas_owner on public.goal_ideas for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
