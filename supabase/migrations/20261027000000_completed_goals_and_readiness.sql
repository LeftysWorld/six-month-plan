-- Completed goals and backlog entry requirements. Safe to run more than once.
--   goals.completed_at / completion_note: a finished goal moves to Completed (its history is kept).
--   goal_ideas.done_means: what done looks like; with the why (note) it's needed to select an idea.

alter table public.goals add column if not exists completed_at timestamptz;
alter table public.goals add column if not exists completion_note text not null default '';
alter table public.goal_ideas add column if not exists done_means text not null default '';
