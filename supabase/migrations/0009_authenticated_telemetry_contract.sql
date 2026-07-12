-- Keep the authenticated analytics RPC aligned with the typed browser client.
-- Migration 0007 is historical; this replacement is what upgrades hosted DBs.

create or replace function public.record_authenticated_analytics_event(
  p_event_name text,
  p_anonymous_id uuid,
  p_client_session_id text,
  p_route text,
  p_properties jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  v_used int;
  v_allowed_events constant text[] := array[
    'first_authenticated', 'feedback_submitted', 'first_reading_viewed',
    'first_reading_opened', 'session_started', 'session_completed',
    'chess_profile_lookup_started', 'chess_profile_unsupported',
    'chess_profile_lookup_succeeded', 'chess_profile_lookup_failed',
    'chess_profile_selected', 'onboarding_goal_saved', 'analysis_started',
    'first_10_ready', 'background_analysis_partial',
    'full_100_or_available_ready', 'room_viewed',
    'table_viewed', 'feedback_opened', 'telemetry_opted_in', 'account_exported',
    'opponent_move_selected'
  ];
  v_allowed_properties constant text[] := array[
    'event_version', 'source', 'kind', 'has_rating', 'batch_size',
    'review_positions', 'has_target', 'reached_practice_game', 'reason',
    'anchor_key', 'reason_code', 'has_rapid', 'has_blitz', 'time_class',
    'horizon_weeks', 'weekly_minutes', 'games_available', 'games_analyzed',
    'games_selected', 'games_failed', 'completion_scope',
    'has_secondary_anchor', 'corpus_fallback', 'opponent_source',
    'fallback_reason', 'unavailable_reason', 'maia_domain', 'target_rating',
    'analysis_completion_id'
  ];
begin
  if v_user_id is null or not (p_event_name = any(v_allowed_events)) then return false; end if;
  if p_client_session_id is not null and char_length(p_client_session_id) > 80 then return false; end if;
  if p_route is not null and char_length(p_route) > 200 then return false; end if;
  if p_properties is null or jsonb_typeof(p_properties) <> 'object'
     or pg_column_size(p_properties) > 8192 then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(p_properties) as keys(property_key)
    where not (property_key = any(v_allowed_properties))
  ) then return false; end if;
  if exists (
    select 1 from jsonb_each(p_properties) as properties(property_key, property_value)
    where jsonb_typeof(property_value) not in ('string', 'number', 'boolean', 'null')
       or (jsonb_typeof(property_value) = 'string'
           and char_length(property_value #>> '{}') > 240)
       or (jsonb_typeof(property_value) = 'number'
           and char_length(property_value::text) > 40)
  ) then return false; end if;
  if p_event_name = 'background_analysis_partial'
     and (
       coalesce(jsonb_typeof(p_properties->'analysis_completion_id'), '') <> 'string'
       or nullif(p_properties->>'analysis_completion_id', '') is null
       or char_length(p_properties->>'analysis_completion_id') > 160
     ) then return false; end if;

  perform pg_advisory_xact_lock(hashtext('analytics:' || v_user_id::text));

  -- A tab can close after the job is persisted but before the callback runs.
  -- Reloads may therefore submit the same terminal coverage again; accept it
  -- idempotently without inserting another row or consuming daily quota.
  if p_event_name = 'background_analysis_partial' and exists (
    select 1
    from public.analytics_events
    where user_id = v_user_id
      and event_name = p_event_name
      and properties->>'analysis_completion_id' = p_properties->>'analysis_completion_id'
  ) then return true; end if;

  select count(*) into v_used from public.analytics_events
    where user_id = v_user_id and created_at >= v_day_start;
  if v_used >= 200 then return false; end if;

  insert into public.analytics_events
    (user_id, anonymous_id, event_name, event_version, client_session_id,
     route, properties, occurred_at, created_at)
  values
    (v_user_id, p_anonymous_id, p_event_name, 1, p_client_session_id,
     p_route, p_properties, clock_timestamp(), clock_timestamp());
  return true;
end;
$$;

revoke all on function public.record_authenticated_analytics_event(text, uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.record_authenticated_analytics_event(text, uuid, text, text, jsonb)
  to authenticated;
