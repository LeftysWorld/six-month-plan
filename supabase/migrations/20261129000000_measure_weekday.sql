-- The day of the week a weekly measurement is taken (1 = Monday … 7 = Sunday). It shows in Today's
-- numbers from that day until it's logged that week. Null = any day.
alter table public.measurement_types add column if not exists weekday smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'measurement_types_weekday_range') then
    alter table public.measurement_types add constraint measurement_types_weekday_range check (weekday is null or weekday between 1 and 7);
  end if;
end $$;
