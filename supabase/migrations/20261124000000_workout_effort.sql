-- Effort per exercise: how hard each exercise was in a logged workout.
--
-- 1. workout_exercises: one row per exercise per logged workout. Effort 1–10 (by reps left on the
--    last set: 10 = none left), whether it hurt and where, and a note.
-- 2. sessions.effort: the whole workout's effort, 1–10, optional (asked when you finish).
--
-- Safe to run twice.

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  exercise text not null default '',
  effort smallint check (effort between 1 and 10),
  pain boolean not null default false,
  pain_where text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists workout_exercises_session_idx on public.workout_exercises (session_id);

alter table public.workout_exercises enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_exercises' and policyname = 'workout_exercises_owner') then
    create policy workout_exercises_owner on public.workout_exercises for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

alter table public.sessions add column if not exists effort smallint;
alter table public.sessions drop constraint if exists sessions_effort_check;
alter table public.sessions add constraint sessions_effort_check check (effort is null or effort between 1 and 10);

notify pgrst, 'reload schema';
