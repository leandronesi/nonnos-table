-- Migration 0005: add goal_deadline to profiles, refresh_after to ingest_jobs.
-- Both nullable, no default — fully retro-compatible.

alter table public.profiles
  add column if not exists goal_deadline date;

alter table public.ingest_jobs
  add column if not exists refresh_after timestamptz;
