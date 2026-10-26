-- Group outcomes and "starts after". Safe to run more than once.
--  * goal_groups.outcome: what the group's goals add up to (e.g. "Qualified for AI product and
--    governance work"). The group card shows it with one roll-up progress bar.
--  * goals.after_goal_id: this goal starts after that one is complete ("Up next" until then,
--    and it doesn't count as behind while it waits).
-- A goal's own "finish by" date uses the existing goals.target_date column.

alter table public.goal_groups add column if not exists outcome text not null default '';
alter table public.goals add column if not exists after_goal_id uuid references public.goals(id) on delete set null;
create index if not exists goals_after_idx on public.goals (after_goal_id);
