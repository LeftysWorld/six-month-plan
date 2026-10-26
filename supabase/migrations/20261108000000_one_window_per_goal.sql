-- One way to say when a goal runs: a goal has its own start and finish, and belongs to one season
-- (the review calendar). Own clocks and "starts after" are folded into those dates.
-- * Each own clock's goals take the clock's start and finish as their own dates and join the season
--   that was running when the clock started (the latest season otherwise); the clock is archived.
--   A user with clocks and no season keeps the first clock as their season.
-- * A goal that "started after" another gets a start date instead: the day that goal was completed,
--   or the day after it is due to finish. The column is then dropped.
-- Safe to run more than once.

do $$
declare
  clock record;
  season record;
  gid uuid;
begin
  for clock in select * from public.plans where solo and archived_at is null loop
    select p.* into season from public.plans p
      where p.user_id = clock.user_id and not p.solo and p.archived_at is null
        and p.start_date <= clock.start_date and p.end_date >= clock.start_date
      order by p.start_date desc limit 1;
    if season.id is null then
      select p.* into season from public.plans p
        where p.user_id = clock.user_id and not p.solo and p.archived_at is null
        order by p.end_date desc limit 1;
    end if;
    if season.id is null then
      update public.plans set solo = false, name = 'My six months' where id = clock.id;
      continue;
    end if;
    for gid in select goal_id from public.plan_goals where plan_id = clock.id loop
      update public.goals set
        start_date = case when clock.start_date > season.start_date then clock.start_date else start_date end,
        target_date = case when type <> 'number' and clock.end_date < season.end_date and (target_date is null or target_date > clock.end_date) then clock.end_date else target_date end
      where id = gid;
      insert into public.plan_goals (user_id, plan_id, goal_id)
        select clock.user_id, season.id, gid
        where not exists (select 1 from public.plan_goals where plan_id = season.id and goal_id = gid);
      delete from public.plan_goals where plan_id = clock.id and goal_id = gid;
    end loop;
    update public.plans set archived_at = now() where id = clock.id;
  end loop;
end;
$$;

-- "Starts after" becomes a start date.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'goals' and column_name = 'after_goal_id') then
    update public.goals g
       set start_date = greatest(
         coalesce(g.start_date, '0001-01-01'::date),
         coalesce(
           (b.completed_at at time zone 'UTC')::date,
           b.target_date + 1,
           (select min(p.end_date) + 1 from public.plan_goals pg join public.plans p on p.id = pg.plan_id where pg.goal_id = b.id and p.archived_at is null)
         )
       )
      from public.goals b
     where g.after_goal_id = b.id;
    alter table public.goals drop column after_goal_id;
  end if;
end;
$$;

-- A plain backlog: one ordered list. "Selected" ideas go back to the list (at the top, in order),
-- and the prepared plan saved on an idea is no longer needed (making a goal asks directly).
update public.goal_ideas set status = 'backlog', rank = rank - 1000000 where status = 'selected';
alter table public.goal_ideas drop constraint if exists goal_ideas_status_check;
alter table public.goal_ideas add constraint goal_ideas_status_check check (status in ('backlog', 'started', 'discarded'));
alter table public.goal_ideas drop column if exists prep;
alter table public.goal_ideas drop column if exists selected_at;

-- One decomposition vocabulary: this week's goal and milestones. Month and 3-month notes are kept
-- on their rows for history but the app no longer asks for them or shows them. Group outcomes go.
alter table public.goal_groups drop column if exists outcome;
