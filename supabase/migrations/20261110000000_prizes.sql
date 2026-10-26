-- Prizes: a treat on a date to hit, on finishing a goal, or on a group landing.
-- See packages/core/src/prizes.ts for the rules (you judge "done"; the app records when and compares with the date).

alter table public.milestones
  add column if not exists value numeric,
  add column if not exists prize text not null default '',
  add column if not exists prize_claimed_at timestamptz;

alter table public.goals
  add column if not exists prize text not null default '',
  add column if not exists prize_on_time text not null default '',
  add column if not exists target_date_at_set date,
  add column if not exists prize_claimed_at timestamptz,
  add column if not exists prize_on_time_claimed_at timestamptz;

alter table public.goal_groups
  add column if not exists prize text not null default '',
  add column if not exists prize_threshold numeric check (prize_threshold is null or (prize_threshold > 0 and prize_threshold <= 1)),
  add column if not exists prize_claimed_at timestamptz;

comment on column public.milestones.value is 'For a number goal: the reading that marks this date hit. A reading at or past it completes the milestone.';
comment on column public.goals.target_date_at_set is 'The target date the on-time bonus is judged against, fixed when the bonus was set.';
comment on column public.goal_groups.prize_threshold is 'Share of the group''s goals (0–1) that must finish for the group prize; null = 0.85.';
