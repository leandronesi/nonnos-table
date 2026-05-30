-- Migration 0006: estende ingest_jobs.status con gli stati intermedi
-- dell'onboarding a due tempi (20+80).
--
-- Senza questi valori nel CHECK constraint, ogni update dell'orchestratore a uno
-- status nuovo viene rifiutato con 400 (check_violation): l'update fallisce in
-- silenzio e il job resta bloccato (scena ferma su "Dammi un attimo").
--
-- Robusto al NOME del constraint: droppa qualunque check su `status`
-- (il nome auto-generato da Postgres puo' variare), poi ricrea quello giusto.

do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.ingest_jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.ingest_jobs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.ingest_jobs
  add constraint ingest_jobs_status_check
  check (status in (
    'queued','fetching',
    'analyzing_first','coaching_first','analyzing_rest',
    'analyzing','coaching','done','error'
  ));
