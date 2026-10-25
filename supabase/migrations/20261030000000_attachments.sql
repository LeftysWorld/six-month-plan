-- Photos and other files on logged tasks. The files live in the private "attachments" storage
-- bucket (created in the initial schema, one folder per user); this table says which task each
-- file belongs to. Safe to run more than once.

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  action_id uuid references public.actions(id) on delete set null,
  path text not null,
  name text not null default '',
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists attachments_session_idx on public.attachments (session_id);
create index if not exists attachments_action_idx on public.attachments (action_id);

alter table public.attachments enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attachments' and policyname = 'attachments_owner') then
    create policy attachments_owner on public.attachments for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end;
$$;

-- The bucket and its owner-only policies, in case the initial schema's storage section was skipped.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'attachments_owner_read') then
    create policy "attachments_owner_read" on storage.objects for select to authenticated
      using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'attachments_owner_write') then
    create policy "attachments_owner_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'attachments_owner_delete') then
    create policy "attachments_owner_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end;
$$;
