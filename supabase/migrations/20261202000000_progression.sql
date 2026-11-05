-- Progression and effort rules: a workout's left-shoulder pain (0–10, asked when you finish, when a
-- limit asks for a pain check) and where training stands (profiles.training_state: the phase, cut
-- until a weight then build, and deload weeks you said no to). Safe to run twice.
alter table public.sessions add column if not exists shoulder_pain smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_shoulder_pain_range') then
    alter table public.sessions add constraint sessions_shoulder_pain_range check (shoulder_pain is null or shoulder_pain between 0 and 10);
  end if;
end $$;
alter table public.profiles add column if not exists training_state jsonb;

notify pgrst, 'reload schema';
