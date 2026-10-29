-- Ideas in groups, planned into a season.
--
-- A group can hold ideas from the backlog as well as goals: "Glamping Site" holds Buy land, Build an
-- A-frame, Build 3 domes and Build 3 tarp glamping sites while they're still ideas, waits on the job
-- as a group, and each idea becomes a goal in that group when you make it one.
--
-- An idea can be planned into a season with rough dates: it shows on the Roadmap for that season as
-- a dashed bar (planned, not committed). Making it a goal starts from that season and those dates;
-- pick this season instead to pull it forward.
--
-- Safe to run twice.

alter table public.goal_ideas add column if not exists group_id uuid references public.goal_groups(id) on delete set null;
alter table public.goal_ideas add column if not exists plan_id uuid references public.plans(id) on delete set null;
alter table public.goal_ideas add column if not exists planned_start date;
alter table public.goal_ideas add column if not exists planned_end date;

notify pgrst, 'reload schema';
