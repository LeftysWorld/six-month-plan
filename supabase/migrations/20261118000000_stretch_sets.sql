-- Stretching sets: each set of a hold is logged with how long you held it.
--
-- The stretching log now works like the workout log: a hold has sets (one long hold, Left and
-- Right, or 3 × 45 s), a timer counts each one down, and the next session shows last time's times.
-- stretch_holds gets one row per set instead of one per hold.
--
-- Needs 20261117000000_stretching.sql first. Safe to run twice.

alter table public.stretch_holds add column if not exists set_no int not null default 1;
alter table public.stretch_holds add column if not exists seconds int;
alter table public.stretch_holds add column if not exists reps int;

notify pgrst, 'reload schema';
