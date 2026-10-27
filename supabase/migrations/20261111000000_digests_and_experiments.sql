-- Weekly digests to an accountability partner, a Sunday review reminder, and path experiments.

alter table public.profiles
  add column if not exists partner_email text,
  add column if not exists review_reminder boolean not null default true;

alter table public.reviews
  add column if not exists digest text not null default '',
  add column if not exists digest_sent_at timestamptz;

alter table public.push_subscriptions
  add column if not exists last_review_on date;

-- Path experiments: a small, dated thing that answers one of a path's questions.
create table if not exists public.path_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path_id uuid not null references public.paths (id) on delete cascade,
  question_id text,
  title text not null,
  due_date date not null,
  note text not null default '',
  result text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists path_experiments_by_user on public.path_experiments (user_id);
alter table public.path_experiments enable row level security;
drop policy if exists "own path_experiments" on public.path_experiments;
create policy "own path_experiments" on public.path_experiments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on column public.reviews.digest is 'Weekly digest text, written by the app when the review is saved; send-digests mails it to profiles.partner_email.';
