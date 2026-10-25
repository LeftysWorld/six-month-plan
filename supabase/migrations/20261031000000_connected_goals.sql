-- Connected goals and shared tasks. Safe to run more than once.
--  * goal_links: two goals you connected by hand (goals that share a task are connected without a row).
--  * actions.kind gains 'measure' (logging it records a number, e.g. the day's weight) and
--    'photo' (logging it takes a photo).
--  * actions.measurement_type_id: the measurement a measure task records.
-- A task already belongs to any number of goals through action_goals, so sharing needs no change there.

create table if not exists public.goal_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_a uuid not null references public.goals(id) on delete cascade,
  goal_b uuid not null references public.goals(id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now(),
  check (goal_a <> goal_b)
);

-- One link per pair, whichever way round it was made.
create unique index if not exists goal_links_pair_idx
  on public.goal_links (user_id, least(goal_a, goal_b), greatest(goal_a, goal_b));

alter table public.goal_links enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'goal_links' and policyname = 'goal_links_owner') then
    create policy goal_links_owner on public.goal_links for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

alter table public.actions drop constraint if exists actions_kind_check;
alter table public.actions add constraint actions_kind_check
  check (kind in ('check', 'count', 'minutes', 'workout', 'study', 'measure', 'photo'));

alter table public.actions add column if not exists measurement_type_id uuid
  references public.measurement_types(id) on delete set null;
