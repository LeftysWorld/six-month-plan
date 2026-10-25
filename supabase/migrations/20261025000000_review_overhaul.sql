-- Review overhaul: reviews remember more, and the review transaction can pause a task
-- or take a task out of next week.
-- * reviews.commitment_kept: did last review's "change next" happen? (yes / partly / no)
-- * reviews.goal_results: how each week, month, 3-month or plan goal turned out
-- * reviews.goal_decisions: 3-month checkpoint keep / adjust / drop per goal
-- * reviews.carry_forward: plan retrospective, what carries into the next plan
-- * reviews.minutes_planned / minutes_done: the time picture of the period
-- * complete_weekly_review: a schedule change with no new schedule pauses the task;
--   sessions may arrive with a status ('moved' = taken out of the week in the review);
--   week_plan is optional (month, 3-month and plan reviews don't plan a week).
-- Safe to run more than once.

alter table public.reviews add column if not exists commitment_kept text;
alter table public.reviews add column if not exists goal_results jsonb not null default '[]'::jsonb;
alter table public.reviews add column if not exists goal_decisions jsonb not null default '[]'::jsonb;
alter table public.reviews add column if not exists carry_forward text not null default '';
alter table public.reviews add column if not exists minutes_planned int not null default 0;
alter table public.reviews add column if not exists minutes_done int not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_commitment_kept_check' and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews add constraint reviews_commitment_kept_check
      check (commitment_kept is null or commitment_kept in ('yes', 'partly', 'no'));
  end if;
end;
$$;

create or replace function public.complete_weekly_review(payload jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  r jsonb := payload -> 'review';
  review_id uuid := coalesce((r ->> 'id')::uuid, gen_random_uuid());
  item jsonb;
  ns jsonb;
  changed_action uuid;
  effective date;
begin
  insert into public.reviews (id, kind, period_start, period_end, status, went_well, got_in_way,
                              change_next, obstacles, actions_done, actions_planned, completed_at,
                              commitment_kept, goal_results, goal_decisions, carry_forward,
                              minutes_planned, minutes_done)
  values (
    review_id,
    r ->> 'kind',
    (r ->> 'period_start')::date,
    (r ->> 'period_end')::date,
    'done',
    coalesce(r ->> 'went_well', ''),
    coalesce(r ->> 'got_in_way', ''),
    coalesce(r ->> 'change_next', ''),
    coalesce(array(select jsonb_array_elements_text(r -> 'obstacles')), '{}'),
    coalesce((r ->> 'actions_done')::numeric, 0),
    coalesce((r ->> 'actions_planned')::int, 0),
    now(),
    nullif(r ->> 'commitment_kept', ''),
    coalesce(r -> 'goal_results', '[]'::jsonb),
    coalesce(r -> 'goal_decisions', '[]'::jsonb),
    coalesce(r ->> 'carry_forward', ''),
    coalesce((r ->> 'minutes_planned')::int, 0),
    coalesce((r ->> 'minutes_done')::int, 0)
  );

  for item in select * from jsonb_array_elements(coalesce(payload -> 'measurements', '[]'::jsonb)) loop
    insert into public.measurements (id, type_id, value, measured_on, source, note)
    values ((item ->> 'id')::uuid, (item ->> 'type_id')::uuid, (item ->> 'value')::numeric,
            (item ->> 'measured_on')::date, 'manual', coalesce(item ->> 'note', ''));
  end loop;

  for item in select * from jsonb_array_elements(coalesce(payload -> 'schedule_changes', '[]'::jsonb)) loop
    update public.action_schedules
       set effective_to = (item ->> 'end_on')::date
     where id = (item ->> 'end_schedule_id')::uuid;
    ns := item -> 'new_schedule';
    changed_action := coalesce((ns ->> 'action_id')::uuid, (item ->> 'action_id')::uuid);
    effective := coalesce((ns ->> 'effective_from')::date, (item ->> 'end_on')::date + 1);
    -- No new schedule = the task is paused from the day after end_on.
    if ns is not null and jsonb_typeof(ns) = 'object' then
      insert into public.action_schedules (id, action_id, rule, days, per_week, effective_from)
      values ((ns ->> 'id')::uuid, (ns ->> 'action_id')::uuid, ns ->> 'rule',
              coalesce(array(select (jsonb_array_elements_text(ns -> 'days'))::int), '{}'),
              (ns ->> 'per_week')::int, (ns ->> 'effective_from')::date);
    end if;
    insert into public.change_log (entity, entity_id, summary, old_value, new_value, effective_from, review_id)
    values ('action_schedule', changed_action, item ->> 'summary',
            item -> 'old_value', item -> 'new_value', effective, review_id);
  end loop;

  for item in select * from jsonb_array_elements(coalesce(payload -> 'action_changes', '[]'::jsonb)) loop
    update public.actions
       set min_label = coalesce(item ->> 'min_label', min_label),
           min_minutes = (item ->> 'min_minutes')::int,
           min_count = (item ->> 'min_count')::int
     where id = (item ->> 'action_id')::uuid;
    insert into public.change_log (entity, entity_id, summary, old_value, new_value, effective_from, review_id)
    values ('action', (item ->> 'action_id')::uuid, item ->> 'summary',
            item -> 'old_value', item -> 'new_value', current_date, review_id);
  end loop;

  if payload ? 'week_plan' and jsonb_typeof(payload -> 'week_plan') = 'object' then
    insert into public.week_plans (id, week_start, available_minutes, planned_minutes, saved_at)
    values ((payload -> 'week_plan' ->> 'id')::uuid,
            (payload -> 'week_plan' ->> 'week_start')::date,
            coalesce((payload -> 'week_plan' ->> 'available_minutes')::int, 0),
            coalesce((payload -> 'week_plan' ->> 'planned_minutes')::int, 0),
            now())
    on conflict (user_id, week_start) do update
      set available_minutes = excluded.available_minutes,
          planned_minutes = excluded.planned_minutes,
          saved_at = now();
  end if;

  for item in select * from jsonb_array_elements(coalesce(payload -> 'sessions', '[]'::jsonb)) loop
    insert into public.sessions (id, action_id, week_start, slot, date, title, priority,
                                 planned_minutes, planned_count, status, origin, note)
    values ((item ->> 'id')::uuid, (item ->> 'action_id')::uuid, (item ->> 'week_start')::date,
            coalesce((item ->> 'slot')::int, 0), (item ->> 'date')::date, item ->> 'title',
            coalesce((item ->> 'priority')::boolean, false),
            coalesce((item ->> 'planned_minutes')::int, 0), (item ->> 'planned_count')::int,
            case when item ->> 'status' = 'moved' then 'moved' else 'planned' end,
            coalesce(item ->> 'origin', 'scheduled'), coalesce(item ->> 'note', ''))
    on conflict (user_id, action_id, week_start, origin, slot)
    do update set date = excluded.date,
                  planned_minutes = excluded.planned_minutes,
                  planned_count = excluded.planned_count,
                  status = excluded.status,
                  note = case when excluded.status = 'moved' then excluded.note else public.sessions.note end
      where public.sessions.status = 'planned';
  end loop;

  return review_id;
end;
$$;

grant execute on function public.complete_weekly_review(jsonb) to authenticated;
