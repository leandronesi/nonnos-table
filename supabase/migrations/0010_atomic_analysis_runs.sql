-- User-triggered refresh/reanalysis must not leave profile, games and jobs in
-- different states. Each RPC runs as one Postgres transaction and derives the
-- owner exclusively from auth.uid().

alter table public.ingest_jobs
  add column if not exists is_silent boolean not null default false;

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
  perform 1 from public.profiles where user_id = v_user_id for update;
  if not found then raise exception 'profile_missing'; end if;

  select id into v_job_id
  from public.ingest_jobs
  where user_id = v_user_id and is_silent = false
  order by created_at desc
  limit 1;
  if v_job_id is not null then return v_job_id; end if;

  if exists (
    select 1 from public.ingest_jobs
    where user_id = v_user_id
      and status in (
        'queued', 'fetching', 'analyzing', 'analyzing_first',
        'coaching_first', 'analyzing_rest', 'coaching'
      )
  ) then raise exception 'analysis_run_in_progress'; end if;

  insert into public.ingest_jobs (
    user_id, status, months_total, months_done, games_total, games_done
  ) values (
    v_user_id, 'queued', 0, 0, 0, 0
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
  ) then raise exception 'analysis_run_in_progress'; end if;

  insert into public.ingest_jobs (
    user_id, status, months_total, months_done, games_total, games_done,
    refresh_after
  ) values (
    v_user_id, 'queued', 0, 0, 0, 0, p_refresh_after
  ) returning id into v_job_id;

  update public.profiles
     set onboarding_state = 'pending'
   where user_id = v_user_id;

  return v_job_id;
end;
$$;

create or replace function public.start_full_reanalysis(
  p_goal_time_class text
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
  ) then raise exception 'analysis_run_in_progress'; end if;

  update public.games
     set analysis_status = 'pending', analysis_path = null, error = null
   where id in (
     select id
     from public.games
     where user_id = v_user_id and time_class = p_goal_time_class
     order by played_at desc
     limit 100
   );

  insert into public.ingest_jobs (
    user_id, status, months_total, months_done, games_total, games_done
  ) values (
    v_user_id, 'analyzing_first', 0, 0, 0, 0
  ) returning id into v_job_id;

  update public.profiles
     set onboarding_state = 'analyzing'
   where user_id = v_user_id;

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
  ) then raise exception 'analysis_run_in_progress'; end if;

  insert into public.ingest_jobs (
    user_id, status, months_total, months_done, games_total, games_done,
    refresh_after, is_silent
  ) values (
    v_user_id, 'queued', 0, 0, 0, 0, p_refresh_after, true
  ) returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function public.start_analysis_refresh(text, timestamptz)
  from public, anon;
grant execute on function public.start_analysis_refresh(text, timestamptz)
  to authenticated;

revoke all on function public.start_full_reanalysis(text)
  from public, anon;
grant execute on function public.start_full_reanalysis(text)
  to authenticated;

revoke all on function public.start_silent_refresh(text, timestamptz)
  from public, anon;
grant execute on function public.start_silent_refresh(text, timestamptz)
  to authenticated;

revoke all on function public.ensure_analysis_job()
  from public, anon;
grant execute on function public.ensure_analysis_job()
  to authenticated;
