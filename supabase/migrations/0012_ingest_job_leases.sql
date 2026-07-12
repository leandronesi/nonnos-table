-- Crash-safe ownership for browser-side ingest/analyze jobs. A lease is scoped
-- to auth.uid(), acquired atomically, renewable only by its opaque token, and
-- replaceable after expiry. Main and silent jobs remain resumable so their
-- persisted refresh_after boundary cannot be lost after a partial delta ingest.

alter table public.ingest_jobs
  add column if not exists kind text not null default 'main',
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

update public.ingest_jobs
set kind = case when is_silent then 'silent' else 'main' end
where kind is distinct from case when is_silent then 'silent' else 'main' end;

alter table public.ingest_jobs
  drop constraint if exists ingest_jobs_kind_check;
alter table public.ingest_jobs
  add constraint ingest_jobs_kind_check check (kind in ('main', 'silent'));
alter table public.ingest_jobs
  drop constraint if exists ingest_jobs_kind_silent_consistency_check;
alter table public.ingest_jobs
  add constraint ingest_jobs_kind_silent_consistency_check
  check ((kind = 'silent') = is_silent);
alter table public.ingest_jobs
  drop constraint if exists ingest_jobs_lease_pair_check;
alter table public.ingest_jobs
  add constraint ingest_jobs_lease_pair_check
  check ((lease_token is null) = (lease_expires_at is null));

create index if not exists ingest_jobs_user_kind_created_idx
  on public.ingest_jobs (user_id, kind, created_at desc);
create index if not exists ingest_jobs_live_lease_idx
  on public.ingest_jobs (user_id, lease_expires_at)
  where lease_token is not null;

create or replace function public.reap_expired_ingest_leases()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  perform pg_advisory_xact_lock(hashtext('analysis-run:' || v_user_id::text));

  with reaped as (
    update public.ingest_jobs j
       set lease_token = null,
           lease_expires_at = null
     where j.user_id = v_user_id
       and j.lease_token is not null
       and j.lease_expires_at <= now()
     returning 1
  )
  select count(*) into v_count from reaped;
  return v_count;
end;
$$;

create or replace function public.claim_ingest_job_lease(
  p_job_id uuid,
  p_lease_seconds integer default 90,
  p_allow_terminal boolean default false
)
returns table (
  job_id uuid,
  claimed boolean,
  lease_token uuid,
  lease_expires_at timestamptz,
  job_status text,
  job_kind text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.ingest_jobs%rowtype;
  v_token uuid;
  v_expires timestamptz;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'invalid_lease_duration';
  end if;

  perform pg_advisory_xact_lock(hashtext('analysis-run:' || v_user_id::text));
  perform public.reap_expired_ingest_leases();

  select * into v_job
  from public.ingest_jobs
  where id = p_job_id and user_id = v_user_id
  for update;
  if not found then raise exception 'ingest_job_missing'; end if;

  if (v_job.kind = 'silent' and v_job.status in ('done', 'error'))
    or (not p_allow_terminal and v_job.kind = 'main' and v_job.status = 'done' and exists (
      select 1 from public.profiles p
      where p.user_id = v_user_id and p.onboarding_state = 'ready'
    )) then
    return query select v_job.id, false, null::uuid, v_job.lease_expires_at,
      v_job.status, v_job.kind;
    return;
  end if;

  if v_job.lease_token is not null and v_job.lease_expires_at > now() then
    return query select v_job.id, false, null::uuid, v_job.lease_expires_at,
      v_job.status, v_job.kind;
    return;
  end if;

  -- One browser worker per user, even when main and silent are distinct jobs.
  if exists (
    select 1 from public.ingest_jobs other
    where other.user_id = v_user_id
      and other.id <> v_job.id
      and other.lease_token is not null
      and other.lease_expires_at > now()
      and other.status <> 'done'
  ) then
    return query select v_job.id, false, null::uuid, v_job.lease_expires_at,
      v_job.status, v_job.kind;
    return;
  end if;

  v_token := gen_random_uuid();
  v_expires := now() + make_interval(secs => p_lease_seconds);
  update public.ingest_jobs
     set lease_token = v_token,
         lease_expires_at = v_expires,
         started_at = coalesce(started_at, now())
   where id = v_job.id and user_id = v_user_id;

  return query select v_job.id, true, v_token, v_expires,
    v_job.status, v_job.kind;
end;
$$;

-- All browser progress/status writes go through this fenced patch. Direct table
-- mutations are revoked below so a stale pre-lease bundle cannot bypass CAS.
create or replace function public.patch_ingest_job_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_patch jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_job_patch';
  end if;
  if p_patch = '{}'::jsonb or pg_column_size(p_patch) > 16384 then
    raise exception 'invalid_job_patch_size';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_patch) as keys(key_name)
    where key_name not in (
      'status', 'months_total', 'months_done', 'games_total', 'games_done',
      'error', 'finished_at'
    )
  ) then raise exception 'invalid_job_patch_key'; end if;
  if p_patch ? 'status' and (
    jsonb_typeof(p_patch -> 'status') <> 'string'
    or p_patch ->> 'status' not in (
      'queued', 'fetching', 'analyzing', 'analyzing_first',
      'coaching_first', 'analyzing_rest', 'coaching'
    )
  ) then raise exception 'invalid_job_status'; end if;
  if (p_patch ? 'months_total' and (
        jsonb_typeof(p_patch -> 'months_total') <> 'number'
        or (p_patch ->> 'months_total')::integer < 0
      ))
    or (p_patch ? 'months_done' and (
        jsonb_typeof(p_patch -> 'months_done') <> 'number'
        or (p_patch ->> 'months_done')::integer < 0
      ))
    or (p_patch ? 'games_total' and (
        jsonb_typeof(p_patch -> 'games_total') <> 'number'
        or (p_patch ->> 'games_total')::integer < 0
      ))
    or (p_patch ? 'games_done' and (
        jsonb_typeof(p_patch -> 'games_done') <> 'number'
        or (p_patch ->> 'games_done')::integer < 0
      )) then raise exception 'invalid_job_progress'; end if;
  if p_patch ? 'error'
    and jsonb_typeof(p_patch -> 'error') not in ('string', 'null') then
    raise exception 'invalid_job_error';
  end if;
  if p_patch ? 'error' and length(coalesce(p_patch ->> 'error', '')) > 4000 then
    raise exception 'invalid_job_error_length';
  end if;
  -- Non-null terminal timestamps are owned by complete_ingest_job_lease.
  if p_patch ? 'finished_at'
    and jsonb_typeof(p_patch -> 'finished_at') <> 'null' then
    raise exception 'invalid_job_finished_at';
  end if;

  update public.ingest_jobs
     set status = case when p_patch ? 'status'
           then p_patch ->> 'status' else status end,
         months_total = case when p_patch ? 'months_total'
           then (p_patch ->> 'months_total')::integer else months_total end,
         months_done = case when p_patch ? 'months_done'
           then (p_patch ->> 'months_done')::integer else months_done end,
         games_total = case when p_patch ? 'games_total'
           then (p_patch ->> 'games_total')::integer else games_total end,
         games_done = case when p_patch ? 'games_done'
           then (p_patch ->> 'games_done')::integer else games_done end,
         error = case when p_patch ? 'error'
           then p_patch ->> 'error' else error end,
         finished_at = case when p_patch ? 'finished_at'
           then null else finished_at end
   where id = p_job_id
     and user_id = v_user_id
     and lease_token = p_lease_token
     and lease_expires_at > now()
  returning id into v_updated;
  return v_updated is not null;
end;
$$;

create or replace function public.renew_ingest_job_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 90
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_expires timestamptz;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'invalid_lease_duration';
  end if;
  update public.ingest_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where id = p_job_id
     and user_id = v_user_id
     and lease_token = p_lease_token
     and lease_expires_at > now()
  returning lease_expires_at into v_expires;
  return v_expires;
end;
$$;

create or replace function public.release_ingest_job_lease(
  p_job_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_released uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  update public.ingest_jobs
     set lease_token = null, lease_expires_at = null
   where id = p_job_id
     and user_id = v_user_id
     and lease_token = p_lease_token
  returning id into v_released;
  return v_released is not null;
end;
$$;

create or replace function public.complete_ingest_job_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_completed uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_status not in ('done', 'error') then raise exception 'invalid_terminal_status'; end if;
  if length(coalesce(p_error, '')) > 4000 then raise exception 'invalid_job_error_length'; end if;
  update public.ingest_jobs
     set status = p_status,
         error = p_error,
         finished_at = now(),
         lease_token = null,
         lease_expires_at = null
   where id = p_job_id
     and user_id = v_user_id
     and lease_token = p_lease_token
     and lease_expires_at > now()
  returning id into v_completed;
  return v_completed is not null;
end;
$$;

-- Re-declare the 0010 start RPCs after the new columns exist. They preserve the
-- original profile/game transaction while distinguishing main from silent and
-- reaping expired ownership before checking conflicts.
create or replace function public.ensure_analysis_job()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  perform pg_advisory_xact_lock(hashtext('analysis-run:' || v_user_id::text));
  perform public.reap_expired_ingest_leases();
  perform 1 from public.profiles where user_id = v_user_id for update;
  if not found then raise exception 'profile_missing'; end if;

  select id into v_job_id
  from public.ingest_jobs
  where user_id = v_user_id and kind = 'main'
  order by created_at desc
  limit 1;
  if v_job_id is not null then return v_job_id; end if;

  if exists (
    select 1 from public.ingest_jobs
    where user_id = v_user_id
      and kind = 'silent'
      and status in (
        'queued', 'fetching', 'analyzing', 'analyzing_first',
        'coaching_first', 'analyzing_rest', 'coaching'
      )
      and (
        lease_expires_at > now()
        or (lease_token is null and created_at > now() - interval '2 minutes')
      )
  ) then raise exception 'analysis_run_in_progress'; end if;

  insert into public.ingest_jobs (
    user_id, status, months_total, months_done, games_total, games_done,
    kind, is_silent
  ) values (
    v_user_id, 'queued', 0, 0, 0, 0, 'main', false
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.start_analysis_refresh(
  p_goal_time_class text,
  p_refresh_after timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_goal_time_class is null or p_goal_time_class not in ('rapid', 'blitz') then
    raise exception 'unsupported_goal_time_class';
  end if;
  perform pg_advisory_xact_lock(hashtext('analysis-run:' || v_user_id::text));
  perform public.reap_expired_ingest_leases();
  perform 1 from public.profiles
   where user_id = v_user_id
     and goal_time_class = p_goal_time_class
     and onboarding_state = 'ready'
   for update;
  if not found then raise exception 'profile_scope_mismatch'; end if;
  if exists (
    select 1 from public.ingest_jobs
    where user_id = v_user_id
      and status in (
        'queued', 'fetching', 'analyzing', 'analyzing_first',
        'coaching_first', 'analyzing_rest', 'coaching'
      )
      and (
        kind = 'main'
        or lease_expires_at > now()
        or (kind = 'silent' and lease_token is null and created_at > now() - interval '2 minutes')
      )
  ) then raise exception 'analysis_run_in_progress'; end if;

  insert into public.ingest_jobs (
    user_id, status, months_total, months_done, games_total, games_done,
    refresh_after, kind, is_silent
  ) values (
    v_user_id, 'queued', 0, 0, 0, 0, p_refresh_after, 'main', false
  ) returning id into v_job_id;
  update public.profiles set onboarding_state = 'pending' where user_id = v_user_id;
  return v_job_id;
end;
$$;

create or replace function public.start_full_reanalysis(p_goal_time_class text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_goal_time_class is null or p_goal_time_class not in ('rapid', 'blitz') then
    raise exception 'unsupported_goal_time_class';
  end if;
  perform pg_advisory_xact_lock(hashtext('analysis-run:' || v_user_id::text));
  perform public.reap_expired_ingest_leases();
  perform 1 from public.profiles
   where user_id = v_user_id
     and goal_time_class = p_goal_time_class
     and onboarding_state = 'ready'
   for update;
  if not found then raise exception 'profile_scope_mismatch'; end if;
  if exists (
    select 1 from public.ingest_jobs
    where user_id = v_user_id
      and status in (
        'queued', 'fetching', 'analyzing', 'analyzing_first',
        'coaching_first', 'analyzing_rest', 'coaching'
      )
      and (
        kind = 'main'
        or lease_expires_at > now()
        or (kind = 'silent' and lease_token is null and created_at > now() - interval '2 minutes')
      )
  ) then raise exception 'analysis_run_in_progress'; end if;

  update public.games
     set analysis_status = 'pending', analysis_path = null, error = null
   where id in (
     select id from public.games
     where user_id = v_user_id and time_class = p_goal_time_class
     order by played_at desc limit 100
   );
  insert into public.ingest_jobs (
    user_id, status, months_total, months_done, games_total, games_done,
    kind, is_silent
  ) values (
    v_user_id, 'analyzing_first', 0, 0, 0, 0, 'main', false
  ) returning id into v_job_id;
  update public.profiles set onboarding_state = 'analyzing' where user_id = v_user_id;
  return v_job_id;
end;
$$;

create or replace function public.start_silent_refresh(
  p_goal_time_class text,
  p_refresh_after timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_goal_time_class is null or p_goal_time_class not in ('rapid', 'blitz') then
    raise exception 'unsupported_goal_time_class';
  end if;
  perform pg_advisory_xact_lock(hashtext('analysis-run:' || v_user_id::text));
  perform public.reap_expired_ingest_leases();
  perform 1 from public.profiles
   where user_id = v_user_id
     and goal_time_class = p_goal_time_class
     and onboarding_state = 'ready'
   for update;
  if not found then raise exception 'profile_scope_mismatch'; end if;

  -- Main work has priority and must finish (or be resumed) first.
  if exists (
    select 1 from public.ingest_jobs
    where user_id = v_user_id
      and kind = 'main'
      and status in (
        'queued', 'fetching', 'analyzing', 'analyzing_first',
        'coaching_first', 'analyzing_rest', 'coaching'
      )
  ) then raise exception 'analysis_run_in_progress'; end if;

  -- Concurrent silent tabs adopt this row, then the lease RPC elects exactly
  -- one browser worker while the others only observe its persisted progress.
  select id into v_job_id
  from public.ingest_jobs
  where user_id = v_user_id
    and kind = 'silent'
    and status in (
      'queued', 'fetching', 'analyzing', 'analyzing_first',
      'coaching_first', 'analyzing_rest', 'coaching'
    )
  order by created_at desc
  limit 1;
  if v_job_id is not null then return v_job_id; end if;

  insert into public.ingest_jobs (
    user_id, status, months_total, months_done, games_total, games_done,
    refresh_after, kind, is_silent
  ) values (
    v_user_id, 'queued', 0, 0, 0, 0, p_refresh_after, 'silent', true
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.reap_expired_ingest_leases() from public, anon;
grant execute on function public.reap_expired_ingest_leases() to authenticated;
revoke all on function public.claim_ingest_job_lease(uuid, integer, boolean) from public, anon;
grant execute on function public.claim_ingest_job_lease(uuid, integer, boolean) to authenticated;
revoke all on function public.patch_ingest_job_lease(uuid, uuid, jsonb) from public, anon;
grant execute on function public.patch_ingest_job_lease(uuid, uuid, jsonb) to authenticated;
revoke all on function public.renew_ingest_job_lease(uuid, uuid, integer) from public, anon;
grant execute on function public.renew_ingest_job_lease(uuid, uuid, integer) to authenticated;
revoke all on function public.release_ingest_job_lease(uuid, uuid) from public, anon;
grant execute on function public.release_ingest_job_lease(uuid, uuid) to authenticated;
revoke all on function public.complete_ingest_job_lease(uuid, uuid, text, text) from public, anon;
grant execute on function public.complete_ingest_job_lease(uuid, uuid, text, text) to authenticated;

revoke all on function public.ensure_analysis_job() from public, anon;
grant execute on function public.ensure_analysis_job() to authenticated;
revoke all on function public.start_analysis_refresh(text, timestamptz) from public, anon;
grant execute on function public.start_analysis_refresh(text, timestamptz) to authenticated;
revoke all on function public.start_full_reanalysis(text) from public, anon;
grant execute on function public.start_full_reanalysis(text) to authenticated;
revoke all on function public.start_silent_refresh(text, timestamptz) from public, anon;
grant execute on function public.start_silent_refresh(text, timestamptz) to authenticated;

-- Creation and mutation are RPC-only. SELECT remains available through the
-- existing self-select RLS policy so observer tabs can render real progress.
revoke insert, update, delete on table public.ingest_jobs from authenticated, anon;
drop policy if exists "ingest_jobs_self_insert" on public.ingest_jobs;
drop policy if exists "ingest_jobs_self_update" on public.ingest_jobs;
