-- Prepare, then commit: a selected idea keeps its prepared plan (chain notes, first daily task,
-- number target) until you commit it as a goal. Safe to run more than once.
alter table public.goal_ideas add column if not exists prep jsonb not null default '{}'::jsonb;
