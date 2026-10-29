-- Stretching: a task type of its own, like workouts.
--
-- 1. actions.kind may be 'stretch'.
-- 2. actions.stretch_plan: the holds for that day (the Daily Eight and the day's focus slot), push
--    or easy, with how-to text. Shown when you open the task; nothing is timed.
-- 3. stretch_holds: each hold of a logged stretching session, ticked off, and whether it hurt.
--
-- Safe to run twice.

alter table public.actions drop constraint if exists actions_kind_check;
alter table public.actions add constraint actions_kind_check
  check (kind in ('check', 'count', 'minutes', 'workout', 'study', 'measure', 'photo', 'stretch'));

alter table public.actions add column if not exists stretch_plan jsonb;

create table if not exists public.stretch_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  position int not null default 0,
  hold text not null default '',
  done boolean not null default false,
  pain boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists stretch_holds_session_idx on public.stretch_holds (session_id);

alter table public.stretch_holds enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stretch_holds' and policyname = 'stretch_holds_owner') then
    create policy stretch_holds_owner on public.stretch_holds for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

notify pgrst, 'reload schema';
