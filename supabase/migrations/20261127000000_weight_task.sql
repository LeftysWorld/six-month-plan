-- Weight: a task type of its own, like workouts and stretching.
--
-- actions.kind may be 'weight': a weigh-in. Checking it off records the day's weight (and can take
-- a progress photo), and its goal gets the weight page: today's weigh-in against the path, the
-- rolling average, the on-track zone, pace and milestones.
--
-- Safe to run twice.

alter table public.actions drop constraint if exists actions_kind_check;
alter table public.actions add constraint actions_kind_check
  check (kind in ('check', 'count', 'minutes', 'workout', 'study', 'measure', 'photo', 'stretch', 'weight'));
