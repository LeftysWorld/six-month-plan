-- Tallies: a date to hit that is a running total of a count task
-- ("250 applications by Dec 15", counted from "Apply to 25 jobs").
-- Every log of the task adds its count to milestones.value's target; the date ticks itself off when it's reached.
-- See packages/core/src/tally.ts.

alter table public.milestones
  add column if not exists count_action_id uuid references public.actions(id) on delete set null;

create index if not exists milestones_count_action_idx on public.milestones (count_action_id) where count_action_id is not null;

comment on column public.milestones.count_action_id is 'The count task whose logged counts add up toward value. Null = a plain date (or, on a number goal, a reading to reach).';
