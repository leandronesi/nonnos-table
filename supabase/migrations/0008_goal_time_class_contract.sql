-- Staged contract for the only goal cadences supported by the browser pipeline.
-- Existing legacy rows are kept readable until their owners explicitly choose
-- rapid or blitz. NOT VALID still enforces the constraint on every new/updated
-- row; after the audit in README, operators can VALIDATE it without downtime.

begin;

alter table public.profiles
  drop constraint if exists profiles_goal_time_class_check;

alter table public.profiles
  add constraint profiles_goal_time_class_supported_check
  check (goal_time_class in ('rapid', 'blitz')) not valid;

-- One-shot, authenticated repair. It deliberately refuses to map a legacy
-- cadence automatically: the user must make the product choice. Profile update
-- and fresh queued job are atomic, and the function can succeed only once.
create or replace function public.recover_legacy_goal_time_class(
  p_goal_time_class text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_rows int;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_goal_time_class is null or p_goal_time_class not in ('rapid', 'blitz') then
    raise exception 'unsupported goal time class';
  end if;

  update public.profiles
  set goal_time_class = p_goal_time_class,
      onboarding_state = 'pending'
  where user_id = v_user_id
    and goal_time_class not in ('rapid', 'blitz');
  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    return false;
  end if;

  insert into public.ingest_jobs
    (user_id, status, months_total, months_done, games_total, games_done)
  values
    (v_user_id, 'queued', 0, 0, 0, 0);

  return true;
end;
$$;

revoke all on function public.recover_legacy_goal_time_class(text)
  from public, anon;
grant execute on function public.recover_legacy_goal_time_class(text)
  to authenticated;

commit;
