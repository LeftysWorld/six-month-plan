-- A goal's own start date (set on the roadmap or in the goal's edit sheet). Safe to run more than once.
-- Empty means it starts with its window (or when the goal it starts after is complete).
alter table public.goals add column if not exists start_date date;
