-- Foundations for product analytics, feedback and longitudinal learning.
-- Every row is owned by auth.uid(); the browser never receives elevated access.

begin;

-- A Chess.com username points to a public data source. It is not an identity
-- credential and must not be globally claimable by the first Mygotham user.
alter table public.profiles
  drop constraint if exists profiles_chess_com_username_key;

drop index if exists public.profiles_chesscom_username_ci;

create index if not exists profiles_chesscom_username_lookup_idx
  on public.profiles (lower(chess_com_username));

comment on column public.profiles.chess_com_username is
  'Public Chess.com profile selected for analysis; ownership is not verified.';

-- Enforce the beta invite at the Auth boundary. The client-side RPC remains a
-- friendly pre-check, but direct calls to auth.signUp cannot bypass this hook.
create or replace function public.hook_validate_invite_code(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := event->'user'->'user_metadata'->>'invite_code';
begin
  if exists (
    select 1 from public.invite_codes
    where active and lower(code) = lower(btrim(coalesce(v_code, '')))
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'A valid beta invite code is required.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_validate_invite_code(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_validate_invite_code(jsonb)
  from public, anon, authenticated;

-- Atomic, fail-closed LLM budget. Existing migration 0003 created the log;
-- clients lose direct INSERT and can only consume quota through this RPC.
alter table public.coach_invocations
  add column if not exists mode text not null default 'brief';
alter table public.coach_invocations
  drop constraint if exists coach_invocations_mode_check;
alter table public.coach_invocations
  add constraint coach_invocations_mode_check check (mode in ('brief', 'teach'));

create index if not exists coach_invocations_created_idx
  on public.coach_invocations (created_at desc);
create index if not exists coach_invocations_user_mode_created_idx
  on public.coach_invocations (user_id, mode, created_at desc);

drop policy if exists coach_invocations_self_insert on public.coach_invocations;
revoke insert on public.coach_invocations from authenticated;

create or replace function public.consume_coach_quota(p_mode text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  v_user_cap int;
  v_used int;
begin
  if v_user_id is null then return 'authentication_required'; end if;
  if p_mode = 'brief' then v_user_cap := 2;
  elsif p_mode = 'teach' then v_user_cap := 3;
  else return 'invalid_mode';
  end if;

  -- One short transaction-wide lock makes the global and per-user checks plus
  -- insert a single atomic budget decision, including concurrent tabs.
  perform pg_advisory_xact_lock(hashtext('coach-quota-global'));

  select count(*) into v_used
    from public.coach_invocations
    where created_at >= v_day_start;
  if v_used >= 15000 then return 'global_limit'; end if;

  select count(*) into v_used
    from public.coach_invocations
    where user_id = v_user_id and mode = p_mode and created_at >= v_day_start;
  if v_used >= v_user_cap then return 'user_limit'; end if;

  insert into public.coach_invocations (user_id, mode)
  values (v_user_id, p_mode);
  return 'accepted';
end;
$$;

revoke all on function public.consume_coach_quota(text) from public, anon;
grant execute on function public.consume_coach_quota(text) to authenticated;

create table if not exists public.analytics_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  anonymous_id      uuid,
  event_name        text not null check (event_name ~ '^[a-z0-9_.-]{1,80}$'),
  event_version     int not null default 1 check (event_version between 1 and 1000),
  client_session_id text check (client_session_id is null or char_length(client_session_id) <= 80),
  route             text check (route is null or char_length(route) <= 200),
  properties        jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(properties) = 'object' and pg_column_size(properties) <= 8192),
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists analytics_events_user_created_idx
  on public.analytics_events (user_id, created_at desc);
create index if not exists analytics_events_name_created_idx
  on public.analytics_events (event_name, created_at desc);
create index if not exists analytics_events_anonymous_created_idx
  on public.analytics_events (anonymous_id, created_at desc)
  where anonymous_id is not null;

-- Authenticated product events are also validated server-side. RLS alone
-- would let a user spam arbitrary event names/properties into their own rows.
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
    'first_10_ready', 'full_100_or_available_ready', 'room_viewed',
    'table_viewed', 'feedback_opened', 'telemetry_opted_in', 'account_exported',
    'opponent_move_selected'
  ];
  v_allowed_properties constant text[] := array[
    'event_version', 'source', 'kind', 'has_rating', 'batch_size',
    'review_positions', 'has_target', 'reached_practice_game', 'reason',
    'anchor_key', 'reason_code',
    'has_rapid', 'has_blitz', 'time_class', 'horizon_weeks',
    'weekly_minutes', 'games_available', 'games_analyzed', 'completion_scope',
    'opponent_source', 'fallback_reason', 'unavailable_reason', 'maia_domain',
    'target_rating'
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

  perform pg_advisory_xact_lock(hashtext('analytics:' || v_user_id::text));
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

-- Pre-auth acquisition denominator. There are deliberately no client RLS
-- policies: only the validated first-party telemetry Edge Function can append.
create table if not exists public.anonymous_analytics_events (
  id                uuid primary key default gen_random_uuid(),
  anonymous_id      uuid not null,
  event_name        text not null check (event_name in (
                      'landing_view', 'signup_started', 'signup_submitted',
                      'signup_succeeded', 'signup_failed'
                    )),
  client_session_id uuid,
  properties        jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(properties) = 'object' and pg_column_size(properties) <= 2048),
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists anonymous_events_anon_created_idx
  on public.anonymous_analytics_events (anonymous_id, created_at desc);
create index if not exists anonymous_events_name_created_idx
  on public.anonymous_analytics_events (event_name, created_at desc);

create table if not exists public.anonymous_telemetry_rate_limits (
  rate_key          text primary key check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  hits              int not null check (hits >= 0)
);

-- Atomic limiter + append. p_rate_key is an HMAC produced by the Edge
-- Function; the raw IP address never reaches Postgres.
create or replace function public.record_anonymous_analytics_event(
  p_rate_key text,
  p_anonymous_id uuid,
  p_event_name text,
  p_client_session_id uuid,
  p_properties jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hits int;
  v_now timestamptz := clock_timestamp();
begin
  if p_rate_key !~ '^[0-9a-f]{64}$'
     or p_event_name not in (
       'landing_view', 'signup_started', 'signup_submitted',
       'signup_succeeded', 'signup_failed'
     )
     or jsonb_typeof(coalesce(p_properties, '{}'::jsonb)) <> 'object' then
    return false;
  end if;

  insert into public.anonymous_telemetry_rate_limits as limits
    (rate_key, window_started_at, hits)
  values (p_rate_key, v_now, 1)
  on conflict (rate_key) do update set
    window_started_at = case
      when limits.window_started_at < v_now - interval '10 minutes' then v_now
      else limits.window_started_at
    end,
    hits = case
      when limits.window_started_at < v_now - interval '10 minutes' then 1
      else limits.hits + 1
    end
  returning hits into v_hits;

  if v_hits > 30 then
    return false;
  end if;

  insert into public.anonymous_analytics_events
    (anonymous_id, event_name, client_session_id, properties, occurred_at)
  values
    (p_anonymous_id, p_event_name, p_client_session_id, coalesce(p_properties, '{}'::jsonb), v_now);

  -- Bounded housekeeping without a scheduler. Roughly one accepted request in
  -- a hundred removes limiter buckets that can no longer be relevant.
  if random() < 0.01 then
    delete from public.anonymous_telemetry_rate_limits
      where window_started_at < v_now - interval '1 day';
  end if;
  return true;
end;
$$;

create table if not exists public.client_errors (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  error_name        text check (error_name is null or char_length(error_name) <= 120),
  message           text not null check (char_length(message) between 1 and 1000),
  stack             text check (stack is null or char_length(stack) <= 6000),
  severity          text not null default 'error' check (severity in ('warning', 'error', 'fatal')),
  route             text check (route is null or char_length(route) <= 200),
  component         text check (component is null or char_length(component) <= 160),
  context           jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 8192),
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists client_errors_user_created_idx
  on public.client_errors (user_id, created_at desc);

create table if not exists public.user_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('diagnosis', 'lesson', 'product', 'bug', 'other')),
  rating      int check (rating is null or rating between 1 and 5),
  subject     text check (subject is null or char_length(subject) <= 160),
  message     text check (message is null or char_length(message) <= 4000),
  context     jsonb not null default '{}'::jsonb
              check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 8192),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (rating is not null or nullif(btrim(message), '') is not null)
);

create index if not exists user_feedback_user_created_idx
  on public.user_feedback (user_id, created_at desc);

drop trigger if exists user_feedback_touch_updated_at on public.user_feedback;
create trigger user_feedback_touch_updated_at
  before update on public.user_feedback
  for each row execute function public.touch_updated_at();

-- Immutable observations from a training interaction. `source_game_id` stays
-- text on purpose: no row may create a cross-user foreign-key relationship.
create table if not exists public.training_attempts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  anchor_key          text not null check (char_length(anchor_key) between 1 and 160),
  source_game_id      text check (source_game_id is null or char_length(source_game_id) <= 160),
  position_id         text check (position_id is null or char_length(position_id) <= 240),
  mode                text not null default 'drill'
                      check (mode in ('watch', 'guided', 'drill', 'review', 'game_transfer')),
  attempt_number      int not null default 1 check (attempt_number between 1 and 100),
  move_uci            text check (move_uci is null or move_uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
  verdict             text check (verdict is null or verdict in ('perfect', 'ok', 'wrong', 'skipped')),
  correct             boolean,
  used_hint           boolean not null default false,
  response_ms         int check (response_ms is null or response_ms between 0 and 3600000),
  maia_current_acceptable_observed_policy numeric
                      check (maia_current_acceptable_observed_policy is null or maia_current_acceptable_observed_policy between 0 and 1),
  maia_target_acceptable_observed_policy numeric
                      check (maia_target_acceptable_observed_policy is null or maia_target_acceptable_observed_policy between 0 and 1),
  context             jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 16384),
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists training_attempts_user_anchor_created_idx
  on public.training_attempts (user_id, anchor_key, created_at desc);

-- Client clocks and caller-supplied timestamps are not trusted for product
-- metrics or mastery scheduling.
create or replace function public.stamp_client_event_time()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.occurred_at := clock_timestamp();
  new.created_at := new.occurred_at;
  return new;
end;
$$;

drop trigger if exists analytics_events_stamp_time on public.analytics_events;
create trigger analytics_events_stamp_time
  before insert on public.analytics_events
  for each row execute function public.stamp_client_event_time();

drop trigger if exists client_errors_stamp_time on public.client_errors;
create trigger client_errors_stamp_time
  before insert on public.client_errors
  for each row execute function public.stamp_client_event_time();

drop trigger if exists training_attempts_stamp_time on public.training_attempts;
create trigger training_attempts_stamp_time
  before insert on public.training_attempts
  for each row execute function public.stamp_client_event_time();

-- Current, recomputable state of an anchor. The attempt log above remains the
-- source of truth; this table makes daily session selection inexpensive.
create table if not exists public.anchor_mastery (
  user_id               uuid not null references auth.users(id) on delete cascade,
  anchor_key            text not null check (char_length(anchor_key) between 1 and 160),
  status                text not null default 'candidate'
                        check (status in ('candidate', 'practicing', 'review', 'mastered')),
  training_attempts     int not null default 0 check (training_attempts >= 0),
  training_successes    int not null default 0 check (training_successes between 0 and training_attempts),
  game_opportunities    int not null default 0 check (game_opportunities >= 0),
  transfer_successes    int not null default 0 check (transfer_successes between 0 and game_opportunities),
  mastery_score         numeric(5,4) not null default 0 check (mastery_score between 0 and 1),
  last_practiced_at     timestamptz,
  last_observed_at      timestamptz,
  next_review_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (user_id, anchor_key)
);

create index if not exists anchor_mastery_user_review_idx
  on public.anchor_mastery (user_id, next_review_at)
  where status <> 'mastered';

create table if not exists public.anchor_transfer_observations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  anchor_key        text not null check (char_length(anchor_key) between 1 and 160),
  observation_key   text not null check (char_length(observation_key) between 1 and 240),
  source_game_id    text check (source_game_id is null or char_length(source_game_id) <= 160),
  position_id       text check (position_id is null or char_length(position_id) <= 240),
  success           boolean not null,
  observed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (user_id, anchor_key, observation_key)
);

create index if not exists anchor_transfer_user_observed_idx
  on public.anchor_transfer_observations (user_id, observed_at desc);

drop trigger if exists anchor_mastery_touch_updated_at on public.anchor_mastery;
create trigger anchor_mastery_touch_updated_at
  before update on public.anchor_mastery
  for each row execute function public.touch_updated_at();

-- Appending an attempt is the only client write required for practice. This
-- trigger updates the projection atomically, so two tabs cannot lose counts.
create or replace function public.project_training_attempt_to_anchor_mastery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_success int := case
    when new.correct is true or new.verdict in ('perfect', 'ok') then 1 else 0
  end;
  v_review_interval interval := case
    when new.verdict = 'perfect' then interval '3 days'
    else interval '1 day'
  end;
begin
  -- Watching, skipped steps and game observations are useful history, but they
  -- are not evaluated practice and must not dilute the mastery projection.
  if new.mode not in ('guided', 'drill', 'review')
     or (new.correct is null and coalesce(new.verdict, 'skipped') = 'skipped') then
    return new;
  end if;

  insert into public.anchor_mastery
    (user_id, anchor_key, status, training_attempts, training_successes,
     mastery_score, last_practiced_at, next_review_at)
  values
    (new.user_id, new.anchor_key, 'practicing', 1, v_success,
     v_success::numeric * 0.6, new.occurred_at, new.occurred_at + v_review_interval)
  on conflict (user_id, anchor_key) do update set
    training_attempts = public.anchor_mastery.training_attempts + 1,
    training_successes = public.anchor_mastery.training_successes + v_success,
    mastery_score = round(
      ((public.anchor_mastery.training_successes + v_success)::numeric /
       (public.anchor_mastery.training_attempts + 1)::numeric) * 0.6
      + case when public.anchor_mastery.game_opportunities > 0 then
          (public.anchor_mastery.transfer_successes::numeric /
           public.anchor_mastery.game_opportunities::numeric) * 0.4
        else 0 end,
      4
    ),
    status = case
      when public.anchor_mastery.status = 'mastered' then 'mastered'
      when public.anchor_mastery.training_attempts + 1 >= 3
       and (public.anchor_mastery.training_successes + v_success)::numeric /
           (public.anchor_mastery.training_attempts + 1)::numeric >= 0.67 then 'review'
      else 'practicing'
    end,
    last_practiced_at = greatest(public.anchor_mastery.last_practiced_at, new.occurred_at),
    next_review_at = new.occurred_at + v_review_interval;
  return new;
end;
$$;

drop trigger if exists training_attempts_project_mastery on public.training_attempts;
create trigger training_attempts_project_mastery
  after insert on public.training_attempts
  for each row execute function public.project_training_attempt_to_anchor_mastery();

-- Transfer is observed in a later real game. The authenticated user is read
-- from auth.uid(); there is no user id argument that a client could spoof.
create or replace function public.record_anchor_transfer(
  p_anchor_key text,
  p_observation_key text,
  p_success boolean,
  p_source_game_id text default null,
  p_position_id text default null
)
returns public.anchor_mastery
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.anchor_mastery;
  v_success int := case when p_success then 1 else 0 end;
  v_observation_id uuid;
  v_observed_at timestamptz := clock_timestamp();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if nullif(btrim(p_anchor_key), '') is null or char_length(p_anchor_key) > 160 then
    raise exception 'invalid anchor key';
  end if;
  if nullif(btrim(p_observation_key), '') is null or char_length(p_observation_key) > 240 then
    raise exception 'invalid observation key';
  end if;

  -- Transfer is meaningful only after an evaluated intervention. Lock the
  -- existing projection so concurrent observations cannot lose increments.
  select * into v_result
    from public.anchor_mastery
    where user_id = v_user_id and anchor_key = p_anchor_key
      and training_attempts > 0
    for update;
  if not found then raise exception 'training prerequisite missing'; end if;

  insert into public.anchor_transfer_observations
    (user_id, anchor_key, observation_key, source_game_id, position_id, success, observed_at)
  values
    (v_user_id, p_anchor_key, p_observation_key, left(p_source_game_id, 160),
     left(p_position_id, 240), p_success, v_observed_at)
  on conflict (user_id, anchor_key, observation_key) do nothing
  returning id into v_observation_id;

  -- A refresh or second tab may report the same real-game opportunity again.
  -- The unique observation key makes the projection exactly-once.
  if v_observation_id is null then
    return v_result;
  end if;

  update public.anchor_mastery set
    game_opportunities = game_opportunities + 1,
    transfer_successes = transfer_successes + v_success,
    mastery_score = round(
      (training_successes::numeric / training_attempts::numeric) * 0.6
      + ((transfer_successes + v_success)::numeric /
         (game_opportunities + 1)::numeric) * 0.4,
      4
    ),
    status = case
      when game_opportunities + 1 >= 3
       and training_attempts >= 3
       and (transfer_successes + v_success)::numeric /
           (game_opportunities + 1)::numeric >= 0.75 then 'mastered'
      else 'review'
    end,
    last_observed_at = greatest(last_observed_at, v_observed_at)
  where user_id = v_user_id and anchor_key = p_anchor_key
  returning * into v_result;
  return v_result;
end;
$$;

alter table public.analytics_events  enable row level security;
alter table public.anonymous_analytics_events enable row level security;
alter table public.anonymous_telemetry_rate_limits enable row level security;
alter table public.client_errors     enable row level security;
alter table public.user_feedback     enable row level security;
alter table public.training_attempts enable row level security;
alter table public.anchor_mastery    enable row level security;
alter table public.anchor_transfer_observations enable row level security;

drop policy if exists analytics_events_self_select on public.analytics_events;
drop policy if exists analytics_events_self_insert on public.analytics_events;
create policy analytics_events_self_select on public.analytics_events
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists client_errors_self_select on public.client_errors;
drop policy if exists client_errors_self_insert on public.client_errors;
create policy client_errors_self_select on public.client_errors
  for select to authenticated using (auth.uid() = user_id);
create policy client_errors_self_insert on public.client_errors
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists user_feedback_self_select on public.user_feedback;
drop policy if exists user_feedback_self_insert on public.user_feedback;
drop policy if exists user_feedback_self_update on public.user_feedback;
drop policy if exists user_feedback_self_delete on public.user_feedback;
create policy user_feedback_self_select on public.user_feedback
  for select to authenticated using (auth.uid() = user_id);
create policy user_feedback_self_insert on public.user_feedback
  for insert to authenticated with check (auth.uid() = user_id);
create policy user_feedback_self_update on public.user_feedback
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_feedback_self_delete on public.user_feedback
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists training_attempts_self_select on public.training_attempts;
drop policy if exists training_attempts_self_insert on public.training_attempts;
create policy training_attempts_self_select on public.training_attempts
  for select to authenticated using (auth.uid() = user_id);
create policy training_attempts_self_insert on public.training_attempts
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists anchor_mastery_self_select on public.anchor_mastery;
drop policy if exists anchor_mastery_self_insert on public.anchor_mastery;
drop policy if exists anchor_mastery_self_update on public.anchor_mastery;
drop policy if exists anchor_mastery_self_delete on public.anchor_mastery;
create policy anchor_mastery_self_select on public.anchor_mastery
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists anchor_transfer_self_select on public.anchor_transfer_observations;
create policy anchor_transfer_self_select on public.anchor_transfer_observations
  for select to authenticated using (auth.uid() = user_id);

revoke all on public.analytics_events, public.anonymous_analytics_events,
  public.client_errors, public.user_feedback,
  public.training_attempts, public.anchor_mastery,
  public.anchor_transfer_observations from anon;
revoke all on public.anonymous_analytics_events from authenticated;
revoke all on public.anonymous_telemetry_rate_limits from anon, authenticated;
revoke all on function public.record_anonymous_analytics_event(text, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_anonymous_analytics_event(text, uuid, text, uuid, jsonb)
  to service_role;
revoke all on function public.record_anchor_transfer(text, text, boolean, text, text)
  from public, anon;
grant execute on function public.record_anchor_transfer(text, text, boolean, text, text)
  to authenticated;
revoke insert on public.analytics_events from authenticated;
grant select on public.analytics_events to authenticated;
grant select, insert on public.client_errors, public.training_attempts to authenticated;
grant select, insert, update, delete on public.user_feedback to authenticated;
revoke insert, update, delete on public.anchor_mastery, public.anchor_transfer_observations from authenticated;
grant select on public.anchor_mastery, public.anchor_transfer_observations to authenticated;

commit;
