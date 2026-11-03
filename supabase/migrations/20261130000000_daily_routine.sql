-- The daily routine on Today (wake-up time and the day's items, each so many minutes after waking).
-- Unset means the default routine at 7:00. Safe to run twice.
alter table public.profiles add column if not exists daily_routine jsonb;

notify pgrst, 'reload schema';
