-- Your own order for goals and groups on the Goals page (drag a goal above or below another, or a group above another).
-- Null = not placed by hand yet; those sort after placed ones, in the app's usual order.

alter table public.goals add column if not exists sort_order integer;
alter table public.goal_groups add column if not exists sort_order integer;

comment on column public.goals.sort_order is 'Hand-set position among its siblings (its group, or the loose goals) on the Goals page. Null = not placed.';
comment on column public.goal_groups.sort_order is 'Hand-set position among groups on the Goals page. Null = not placed.';
