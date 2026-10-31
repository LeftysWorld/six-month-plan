-- Settings that shape training, saved on your profile (Settings → Training and Body):
-- training_rules (limits, equipment, weight steps, training week), workout_prefs (effort rating,
-- whole-workout rating, rest vibration) and body_prefs (tape-measuring day, photo reminder).
-- Unset means the defaults. The workout coach reads training_rules as rules it can't break.
--
-- Safe to run twice.

alter table public.profiles add column if not exists training_rules jsonb;
alter table public.profiles add column if not exists workout_prefs jsonb;
alter table public.profiles add column if not exists body_prefs jsonb;

notify pgrst, 'reload schema';
