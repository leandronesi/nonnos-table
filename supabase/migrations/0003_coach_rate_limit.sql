-- Rate-limit / tetto costi per coach-llm.
--
-- 1 riga per ogni invocazione andata a buon fine di coach-llm. L'Edge Function
-- conta le righe delle ultime 24h per utente e rifiuta oltre un tetto, così un
-- utente (o un retry-loop buggato) non può far esplodere la bolletta OpenAI.
--
-- Isolata per utente via RLS, come le altre tabelle (0001_init.sql).

create table public.coach_invocations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index coach_invocations_user_created_idx
  on public.coach_invocations (user_id, created_at desc);

alter table public.coach_invocations enable row level security;

create policy "coach_invocations_self_select" on public.coach_invocations
  for select using (auth.uid() = user_id);

create policy "coach_invocations_self_insert" on public.coach_invocations
  for insert with check (auth.uid() = user_id);
