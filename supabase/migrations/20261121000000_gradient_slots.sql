-- Each group and path keeps its gradient: which of the 32 curated gradients it wears.
--
-- A new group (or path) takes the lowest gradient not worn by a group that's still going (some goal
-- running, or ideas in the backlog) or a path that isn't archived. When a group's goals are all
-- completed or archived, or a path is archived, its gradient is free for the next new one. Saving
-- the slot means nobody else's colour shifts when one finishes.
--
-- Safe to run twice.

alter table public.goal_groups add column if not exists gradient_slot int;
alter table public.paths add column if not exists gradient_slot int;

notify pgrst, 'reload schema';
