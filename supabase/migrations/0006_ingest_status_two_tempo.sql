-- Migration 0006: estende ingest_jobs.status con gli stati intermedi
-- dell'onboarding a due tempi (20+80).
--
-- Senza questi valori nel CHECK constraint, ogni update dell'orchestratore a uno
-- status nuovo viene rifiutato con 400 (check_violation): l'update fallisce in
-- silenzio e il job resta bloccato (scena ferma su "Dammi un attimo").

alter table public.ingest_jobs
  drop constraint if exists ingest_jobs_status_check;

alter table public.ingest_jobs
  add constraint ingest_jobs_status_check
  check (status in (
    'queued','fetching',
    'analyzing_first','coaching_first','analyzing_rest',
    'analyzing','coaching','done','error'
  ));
