-- Waiting on: an idea (or a whole group) that can't really start until something else is done.
--
-- "Glamping site" waits on "Land an AI product owner role". Not a date: the app doesn't schedule
-- it, it holds it. It stays in Later as "Waiting · 6 weeks", can't be made a goal without
-- "Start anyway" and a reason, shows on the Timeline as a dashed lane after the goal it waits on,
-- and when that goal (or one of its milestones, like "Offer signed") is done, Today asks whether to
-- prepare it.
--
-- waits_on_goal_id / waits_on_milestone_id: what it waits on (one of them; a milestone wins).
-- waiting_since: when it started waiting (for "waiting 9 weeks").
--
-- Safe to run twice.

alter table public.goal_ideas add column if not exists waits_on_goal_id uuid references public.goals(id) on delete set null;
alter table public.goal_ideas add column if not exists waits_on_milestone_id uuid references public.milestones(id) on delete set null;
alter table public.goal_ideas add column if not exists waiting_since timestamptz;

alter table public.goal_groups add column if not exists waits_on_goal_id uuid references public.goals(id) on delete set null;
alter table public.goal_groups add column if not exists waits_on_milestone_id uuid references public.milestones(id) on delete set null;
alter table public.goal_groups add column if not exists waiting_since timestamptz;

notify pgrst, 'reload schema';
