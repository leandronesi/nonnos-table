-- Nonno's Table — schema iniziale multi-utente.
--
-- 3 tabelle sotto auth.users (Supabase Auth):
--   profiles      identità del giocatore (chess.com username, obiettivo, stato onboarding)
--   games         indice partite scaricate (PGN sta su Storage, qui solo metadati)
--   ingest_jobs   stato del job di ingest+analyze (per progress UI + ripresa)
--
-- Tutto isolato per user_id via RLS Postgres: l'utente A non vede mai dati
-- dell'utente B, nemmeno provando con la sua chiave anon.

-- =========================================================================
-- 1. profiles
-- =========================================================================
create table public.profiles (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  chess_com_username   text unique not null,
  goal_rating          int  not null check (goal_rating between 800 and 2400),
  goal_horizon_weeks   int  not null check (goal_horizon_weeks between 4 and 52),
  goal_time_class      text not null check (goal_time_class in ('bullet','blitz','rapid','classical','daily')),
  weekly_minutes       int  not null check (weekly_minutes between 15 and 600),
  onboarding_state     text not null default 'pending'
                       check (onboarding_state in ('pending','ingesting','analyzing','coaching','ready','error')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- chess.com username case-insensitive unique (l'API è case-insensitive).
create unique index profiles_chesscom_username_ci
  on public.profiles (lower(chess_com_username));

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- =========================================================================
-- 2. games
-- =========================================================================
-- 1 riga per partita scaricata. Il PGN vivo è su Storage:
--   users/<user_id>/raw/<YYYY-MM>/<chess_com_uuid>.pgn
-- L'analisi finita è su Storage:
--   users/<user_id>/analysis/<chess_com_uuid>.json
create table public.games (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  chess_com_uuid    text not null,
  played_at         timestamptz not null,
  time_class        text not null,
  time_control      text,
  color             text not null check (color in ('white','black')),
  result            text not null check (result in ('win','loss','draw')),
  player_rating     int,
  opponent_rating   int,
  pgn_path          text not null,           -- path su Storage
  analysis_path     text,                    -- path su Storage (NULL finché non analizzata)
  analysis_status   text not null default 'pending'
                    check (analysis_status in ('pending','analyzing','done','error')),
  error             text,
  created_at        timestamptz not null default now()
);

create unique index games_user_chesscom_uuid_unique
  on public.games (user_id, chess_com_uuid);

create index games_user_played_at_idx
  on public.games (user_id, played_at desc);

create index games_user_pending_idx
  on public.games (user_id, analysis_status)
  where analysis_status in ('pending','analyzing');

-- =========================================================================
-- 3. ingest_jobs
-- =========================================================================
-- 1 riga per "campagna di ingest" (di solito 1 sola per utente, alla
-- prima onboarding; futuro: refresh manuale ne crea altri).
create table public.ingest_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'queued'
                  check (status in ('queued','fetching','analyzing','coaching','done','error')),
  months_total    int  not null default 0,
  months_done     int  not null default 0,
  games_total     int  not null default 0,
  games_done      int  not null default 0,
  error           text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index ingest_jobs_user_created_idx
  on public.ingest_jobs (user_id, created_at desc);

create trigger ingest_jobs_touch_updated_at
  before update on public.ingest_jobs
  for each row execute function public.touch_updated_at();

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.profiles    enable row level security;
alter table public.games       enable row level security;
alter table public.ingest_jobs enable row level security;

-- profiles
create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = user_id);

create policy "profiles_self_insert" on public.profiles
  for insert with check (auth.uid() = user_id);

create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- games
create policy "games_self_select" on public.games
  for select using (auth.uid() = user_id);

create policy "games_self_insert" on public.games
  for insert with check (auth.uid() = user_id);

create policy "games_self_update" on public.games
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "games_self_delete" on public.games
  for delete using (auth.uid() = user_id);

-- ingest_jobs
create policy "ingest_jobs_self_select" on public.ingest_jobs
  for select using (auth.uid() = user_id);

create policy "ingest_jobs_self_insert" on public.ingest_jobs
  for insert with check (auth.uid() = user_id);

create policy "ingest_jobs_self_update" on public.ingest_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
