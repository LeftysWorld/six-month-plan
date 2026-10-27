-- Selected for next: a second bucket in the backlog for ideas refined enough to commit (a why and what done looks like).
-- Kept as a timestamp on the idea; status stays 'backlog' so nothing else changes.

alter table public.goal_ideas add column if not exists shortlisted_at timestamptz;

comment on column public.goal_ideas.shortlisted_at is 'Set when the idea is moved to "Selected for next"; null = plain backlog. Ranks are kept per bucket.';
