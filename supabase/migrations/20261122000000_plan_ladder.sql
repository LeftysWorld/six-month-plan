-- Plan this goal: the ladder from the finish back to this week.
--
-- A goal is planned top down: 6 months (the goal) → 3 months → this month → this week → the
-- week's tasks. Each level holds up to three targets, and each target answers to one above it
-- (parent_id). A task is linked to the week target it serves (actions.step_id, already there).
--
-- plan_steps.slot     which of the period's targets a row is (0–2); older rows are 0.
-- plan_steps.done_means  how you'll know the target is done, in a line.
-- goals.pace_curve    how the goal's running total or number is spread over its run
--                     ('even', 'ramp' or 'front'), so suggestions follow the shape you chose.
--
-- Safe to run twice. Nothing is dropped.

alter table public.plan_steps add column if not exists slot int not null default 0;
alter table public.plan_steps add column if not exists done_means text not null default '';

alter table public.goals add column if not exists pace_curve text not null default 'even';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goals_pace_curve_check') then
    alter table public.goals add constraint goals_pace_curve_check check (pace_curve in ('even', 'ramp', 'front'));
  end if;
end $$;

create index if not exists plan_steps_by_period on public.plan_steps (user_id, goal_id, level, start_date, slot);

notify pgrst, 'reload schema';
