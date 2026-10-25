-- Which measurements show in Today's numbers. Null = the default (on for a goal's main number).
alter table public.measurement_types add column if not exists on_today boolean;
