-- Goal groups: named groups of goals made by dragging one goal onto another, like phone folders.
-- A goal is in one group at most (goals.group_id). Safe to run more than once.
-- Connections made earlier (goal_links) are turned into groups by the app the next time it opens.

create table if not exists public.goal_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.goal_groups enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'goal_groups' and policyname = 'goal_groups_owner') then
    create policy goal_groups_owner on public.goal_groups for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

alter table public.goals add column if not exists group_id uuid references public.goal_groups(id) on delete set null;
create index if not exists goals_group_idx on public.goals (group_id);
