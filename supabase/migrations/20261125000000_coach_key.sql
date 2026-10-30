-- The workout coach's key, made in the app (Settings → Workout coach): only its SHA-256 hash is
-- stored, on your profile. The coach sends the key; the app's server function hashes it and finds
-- whose data it opens. Making a new key replaces the old one.
--
-- Safe to run twice.

alter table public.profiles add column if not exists coach_key_hash text;
create unique index if not exists profiles_coach_key_hash on public.profiles (coach_key_hash) where coach_key_hash is not null;

notify pgrst, 'reload schema';
