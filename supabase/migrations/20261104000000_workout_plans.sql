-- A workout task's plan: each exercise with sets, a rep range, a target weight and rest.
alter table public.actions add column if not exists workout_plan jsonb;
