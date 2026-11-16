-- Which shipped plan updates (apps/web/src/data/updates.ts) an account is offered, by id.
-- An update is written for one person's plan, so a new account is offered none: to offer one,
-- add its id to that profile's list. Safe to run twice.
alter table public.profiles add column if not exists app_updates text[] not null default '{}';

notify pgrst, 'reload schema';
