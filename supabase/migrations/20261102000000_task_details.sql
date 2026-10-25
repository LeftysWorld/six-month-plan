-- Task details: what a daily task involves (a workout's exercises, sets and reps), shown when you
-- log it. Safe to run more than once.
alter table public.actions add column if not exists details text not null default '';
