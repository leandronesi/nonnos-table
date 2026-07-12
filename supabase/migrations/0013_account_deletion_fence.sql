-- Account deletion is a multi-service operation: Storage must be empty before
-- auth.users can be deleted, while already-issued JWTs remain valid until
-- expiry. A server-owned fence closes that race. It is inserted before any
-- destructive work and cascades only when auth user deletion succeeds.

create table if not exists public.account_deletion_fences (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

alter table public.account_deletion_fences enable row level security;

-- There are deliberately no client policies. Only the account-data Edge
-- Function's service role can stage/read a fence; users cannot remove it to
-- resume uploads after requesting irreversible deletion.
revoke all on public.account_deletion_fences from public, anon, authenticated;
grant select, insert, delete on public.account_deletion_fences to service_role;

create or replace function public.user_storage_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.profiles p where p.user_id = auth.uid()
    )
    and not exists (
      select 1 from public.account_deletion_fences f where f.user_id = auth.uid()
    );
$$;

revoke all on function public.user_storage_access_allowed() from public, anon;
grant execute on function public.user_storage_access_allowed() to authenticated;

-- Keep the original path isolation and add liveness/fence checks to every
-- operation. The service role bypasses these policies for verified cleanup.
drop policy if exists "user_data_select_self" on storage.objects;
create policy "user_data_select_self" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.user_storage_access_allowed()
  );

drop policy if exists "user_data_insert_self" on storage.objects;
create policy "user_data_insert_self" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.user_storage_access_allowed()
  );

drop policy if exists "user_data_update_self" on storage.objects;
create policy "user_data_update_self" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.user_storage_access_allowed()
  )
  with check (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.user_storage_access_allowed()
  );

drop policy if exists "user_data_delete_self" on storage.objects;
create policy "user_data_delete_self" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.user_storage_access_allowed()
  );
