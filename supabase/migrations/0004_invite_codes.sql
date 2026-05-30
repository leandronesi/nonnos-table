-- Codici invito per la beta chiusa (gate al signup).
-- I codici NON sono leggibili da anon (nessuna policy SELECT): si validano solo
-- tramite la RPC is_valid_invite_code, che ritorna un booleano senza esporre la
-- tabella. Codici riutilizzabili (più amici stesso codice) — sufficiente per l'MVP.

create table public.invite_codes (
  code        text primary key,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.invite_codes enable row level security;
-- Nessuna policy diretta: accesso solo via RPC security definer qui sotto.

create or replace function public.is_valid_invite_code(p_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.invite_codes
    where lower(code) = lower(trim(p_code)) and active
  );
$$;

grant execute on function public.is_valid_invite_code(text) to anon, authenticated;
