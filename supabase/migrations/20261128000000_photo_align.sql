-- Lining up progress photos for the overlay on the Photos page: where the body is on each photo
-- (eyes and hips, found by pose detection) and the zoom and move that put it on the first photo.
-- Only the overlay uses it; the photos themselves are never changed. Safe to run more than once.

alter table public.attachments add column if not exists align jsonb;
