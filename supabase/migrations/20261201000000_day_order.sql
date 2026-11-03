-- Your order for a day's tasks on Today (0 = top), set by dragging a card. Null = the default
-- order (priority first). Safe to run twice.
alter table public.sessions add column if not exists day_order integer;

notify pgrst, 'reload schema';
