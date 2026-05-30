# Setup Supabase per Nonno's Table

Tutto quello che ti serve fare lato Supabase + repo, da zero, per portare in
piedi il nuovo flusso auth + onboarding (vedi `docs/SAAS_TRANSITION.md` per
il contesto storico, e la memoria `architecture-zero-worker.md` per il perché
delle scelte).

---

## 1. Crea il progetto Supabase

1. Vai su https://supabase.com/dashboard, "New project".
2. Region: `eu-central-1` (Francoforte).
3. Salva da subito:
   - **Project URL** (es. `https://abcdefghij.supabase.co`)
   - **anon public key** (sicura lato browser, RLS protegge i dati)
   - **service_role key** (NON la usiamo lato FE — solo per gli Edge Functions
     e operazioni admin)

## 2. Applica le migrazioni

Due SQL files nel repo:

```
supabase/migrations/0001_init.sql    → tabelle profiles, games, ingest_jobs + RLS
supabase/migrations/0002_storage.sql → bucket 'user-data' privato + policy RLS
```

Modo più semplice (senza Supabase CLI):

1. Dashboard Supabase → **SQL Editor**.
2. Incolla `0001_init.sql`, Run.
3. Incolla `0002_storage.sql`, Run.

Modo con CLI (consigliato per CI futura):

```powershell
npm i -g supabase
supabase link --project-ref <PROJECT_REF>
supabase db push
```

## 3. Configura Auth

Dashboard → **Authentication → Providers → Email**:

- ✅ Email confirmation: **on** (obbligatoria, deciso).
- ✅ Sicuro password length min: 8.
- Email template "Confirm signup": tieni quello di default per ora.

Dashboard → **Authentication → URL Configuration**:

- Site URL: per dev locale `http://localhost:5173/`, per prod
  `https://leandronesi.github.io/nonnos-table/` (o il dominio finale).
- Redirect URLs (whitelist):
  - `http://localhost:5173/onboarding`
  - `http://localhost:5173/login`
  - `https://leandronesi.github.io/nonnos-table/onboarding`
  - `https://leandronesi.github.io/nonnos-table/login`

## 4. SMTP per email transazionali

Per dev va bene il SMTP di default di Supabase (limitato a 4 mail/h, basta per
test).

Per prod, configura Resend (gratis 3k/mese):

1. Resend dashboard → API Key.
2. Supabase → **Authentication → Email Templates → SMTP Settings**:
   - Host: `smtp.resend.com`, Port: 465, Username: `resend`, Password: API key.
   - Sender: `onboarding@resend.dev` (default) o un tuo dominio verificato.

## 5. Deploy della Edge Function `coach-llm`

L'unica chiamata server-side dell'architettura (vedi
`memory/architecture_zero_worker.md`). Serve perché `OPENAI_API_KEY` non può
vivere nel browser.

```powershell
# Login Supabase CLI
supabase login
supabase link --project-ref <PROJECT_REF>

# Deploy
supabase functions deploy coach-llm

# Set secret
supabase secrets set OPENAI_API_KEY=sk-...
# Opzionale: cambia modello (default gpt-4o-mini)
supabase secrets set OPENAI_MODEL=gpt-4o-mini
```

`SUPABASE_URL` e `SUPABASE_ANON_KEY` sono auto-iniettati nelle Edge Functions —
non devi settarli.

## 6. Variabili d'ambiente frontend

```powershell
cp frontend/.env.example frontend/.env.local
```

Riempi:

```
VITE_SUPABASE_URL=https://abcdefghij.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

## 7. Run locale

```powershell
cd frontend
npm install
npm run dev
```

Vai a http://localhost:5173 → ti porta a `/login`.

Flow di test:
1. `/signup` con una email che gestisci → ricevi link conferma.
2. Click link → ritorni a `/onboarding`.
3. Inserisci uno username Chess.com valido (es. il tuo).
4. Inserisci obiettivo (rating + orizzonte + minuti/sett).
5. `/onboarding/waiting` → parte ingest+analyze nel browser. Può durare
   10-40 min. Puoi chiudere e tornare, riprende dove era.
6. Quando lo stato passa a `ready` → `/` ti mostra il Coach Brief di Nonno.

## 8. Deploy GH Pages

Il workflow `.github/workflows/refresh-and-deploy.yml` già esiste per la v2
single-user. Va aggiornato per:

- Buildare il FE con `VITE_BASE=/nonnos-table/`.
- Passare `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` come GH Secret.
- NON serve più la pipeline Python per il deploy (quella resta come "lab tool
  del PO" sul tuo Windows, vedi memory `project_overview.md`).

In GH repo → **Settings → Secrets and variables → Actions**, aggiungi:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Esempio update del workflow build step:

```yaml
- name: Build FE
  env:
    VITE_BASE: /Mygotham/
    VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
    VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
  run: |
    cd frontend
    npm ci
    npm run build
```

E poi pubblica `frontend/dist/` su `gh-pages`.

## 9. Verifica RLS funzionante

Dashboard → **Table Editor → profiles** → "Insert row" con utente A: deve
rifiutarsi se non autenticato come quello user. Stesso check su games e
ingest_jobs.

## 10. Cose che NON facciamo ancora (volutamente)

- Stripe / paywall — fuori scope per MVP auth+onboarding.
- Pattern detection avanzata / Maia / repertorio — arrivano con refresh
  successivi (lazy port, vedi memory `architecture_zero_worker.md`).
- Email "il tuo Tavolo è pronto" — l'utente sta sulla `/onboarding/waiting`,
  inutile finché non è un problema osservato.
- Mobile native — web responsive prima.
