-- Plan an idea before it's a goal, and require the plan to commit it.
--
-- "Make it a goal" now runs Plan this goal on the idea: what it is and when (the 6-month level),
-- the 3-month checkpoint and the first month, and, when it starts within two weeks, its first week
-- and tasks. The goal is made only once the first three are set. Until then the plan is kept on
-- the idea as a draft, so you can plan a bit at any time and pick it up later:
--
-- goal_ideas.plan_draft  the draft plan (jsonb): the goal as it will be made, its pace, its targets
--                        per level and the first week's tasks. Cleared when the goal is made.
--
-- Safe to run twice. Nothing is dropped.

alter table public.goal_ideas add column if not exists plan_draft jsonb;

notify pgrst, 'reload schema';
