# Nonno's Table / Mygotham

Un coach di scacchi che studia le partite reali di ogni giocatore, trova errori
ricorrenti e costruisce sessioni sulle posizioni in cui quel giocatore deve
migliorare.

L'idea non è chiedere soltanto «che cosa avrebbe giocato Stockfish?». Stockfish
verifica la qualità scacchistica delle alternative; Maia descrive quanto certe
scelte siano naturali per giocatori a livelli diversi. Le probabilità di policy
Maia sono segnali comparativi grezzi, non percentuali calibrate di persone né
promesse di guadagno Elo.

> **License review required before public launch.** Il browser include/deriva
> componenti GPL-3.0 e carica pesi Maia indicati come AGPLv3. Vedi
> [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). La licenza MIT alla radice
> non risolve automaticamente questi obblighi.

## Prodotto attuale

Il percorso multiutente è una SPA React:

1. l'utente crea un account Supabase e sceglie un profilo pubblico Chess.com;
2. il browser importa fino a 100 partite della cadenza scelta (rapid o blitz)
   e analizza un primo lotto subito;
3. Stockfish WASM, chess.js e Maia-3 ONNX lavorano nel browser;
4. PGN, analisi e quaderno sono salvati nel bucket Supabase privato dell'utente;
5. aggregati e posizioni alimentano Tavolo, sessione e spiegazioni di Nonno;
6. lo schema salva tentativi e mastery; il collegamento automatico delle future
   partite alle opportunità di transfer è predisposto ma non ancora completo.

Lo username Chess.com è una fonte dati pubblica, non una credenziale: non ne
verifichiamo la proprietà e più utenti possono analizzare lo stesso profilo.

## Architettura

```text
Chess.com API
    │
    ▼
React SPA ── chess.js + Stockfish WASM + Maia-3 ONNX
    │
    ├── Supabase Auth
    ├── Postgres + RLS (profilo, indice partite, eventi, feedback, apprendimento)
    ├── Storage privato <user_id>/raw|analysis|quaderno
    └── Edge Functions
          ├── coach-llm     proxy autenticato verso OpenAI
          ├── account-data export/cancellazione account
          └── telemetry     soli eventi pre-login allowlisted e rate-limited
```

La cartella `backend/` contiene la precedente pipeline Python single-user. È
utile per ricerca e confronto, ma non è il runtime della web app multiutente e
non viene eseguita dal deploy di produzione.

## Privacy e trust

- Tutte le tabelle utente hanno RLS `auth.uid() = user_id`.
- Il client non può indicare quale account esportare o cancellare: la Edge
  Function usa esclusivamente il JWT verificato.
- La cancellazione inserisce prima una fence server-owned che blocca nuove
  operazioni Storage anche ai JWT già emessi, svuota e verifica il prefisso
  privato, poi elimina `auth.users`; i dati DB e la fence vanno via in cascata.
  Se un passaggio fallisce prima della fine, la fence resta e la richiesta è
  ritentabile senza riaprire la finestra di upload.
- Diario, SRS, sessione e cache personali nel browser sono namespaced per UUID.
  Il logout non li distrugge; un account diverso non può leggerli. Le
  impostazioni permettono di pulire esplicitamente il dispositivo.
- La telemetria first-party è consent-first: resta spenta e non crea UUID o
  code anonime finché l'utente non la abilita esplicitamente. Esclude email,
  username, token, password, PGN e FEN e rispetta Global Privacy Control e Do
  Not Track. Di conseguenza ogni metrica va pubblicata con la propria copertura
  di consenso, non come censimento di tutti gli utenti.
- Gli eventi anonimi ammessi sono `landing_view`, `signup_started`,
  `signup_submitted`, `signup_succeeded` e `signup_failed`; per i fallimenti
  passa soltanto un reason code, mai il testo libero.
- La funzione filtra proprietà e dimensione del body e applica un rate limit
  atomico. Usa HMAC dell'IP solo quando il deploy fornisce un header proxy
  affidabile; altrimenti ripiega sull'UUID anonimo del browser, che è ruotabile
  e quindi meno resistente agli abusi. CORS/origin non sostituisce un proxy o
  un WAF.
- Gli eventi autenticati passano da una RPC con allowlist e tetto giornaliero;
  il client non ha INSERT diretto sulla tabella analytics.
- Per generare spiegazioni, fatti scacchistici della posizione e aggregati del
  coach possono essere inviati a OpenAI soltanto dalla Edge Function: la chiave
  del servizio non entra mai nel bundle.

L'export JSON comprende account, righe DB e manifest dei file privati. I file
restano scaricabili dal bucket autenticato; non vengono resi pubblici.

## Setup frontend

Prerequisiti: Node 20.19+ (oppure 22.12+) e un progetto Supabase.

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Variabili Vite:

```dotenv
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
VITE_PRIVACY_CONTACT_EMAIL=privacy@example.org
VITE_MAIA_MODEL_URL=https://cdn.example.org/maia/maia3_simplified.onnx
```

`npm run build` esegue prima un controllo che rifiuta PGN, database e output
legacy (`metrics.json`, `player_model.json`, analisi, quaderno) dentro
`frontend/public/`.

## Setup Supabase

Applica le migration e pubblica le funzioni:

```powershell
supabase link --project-ref PROJECT_REF
supabase db push
supabase functions deploy coach-llm
supabase functions deploy account-data
supabase functions deploy telemetry --no-verify-jwt
```

Configura i secret server-side:

```text
OPENAI_API_KEY
APP_ALLOWED_ORIGINS=https://example.github.io
TELEMETRY_ALLOWED_ORIGINS=https://example.github.io
TELEMETRY_IP_HASH_SECRET=<almeno 32 caratteri casuali>
TELEMETRY_TRUST_X_FORWARDED_FOR=true
```

`TELEMETRY_TRUST_X_FORWARDED_FOR=true` va usato soltanto se l'infrastruttura
elimina gli header forniti dal chiamante e scrive un valore fidato. Senza un
header IP fidato il limiter anonimo usa l'UUID installazione e va considerato
una protezione debole, non una barriera anti-bot.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` sono esposti
automaticamente alle Edge Functions ospitate. La service-role key non deve mai
essere aggiunta a `.env` del frontend, a GitHub Pages o ai log.

Nelle impostazioni Auth di Supabase aggiungi agli URL consentiti:

- `/onboarding` per la conferma email;
- `/update-password` per il recupero password;
- gli equivalenti localhost per sviluppo.

La migration crea `public.hook_validate_invite_code`, ma **non basta il DB
push**: nel progetto hosted apri Authentication > Hooks, abilita il hook
"Before User Created" e seleziona quella funzione. Prima di aprire gli inviti,
esegui uno smoke test chiamando direttamente `auth.signUp`: senza
`options.data.invite_code` e con codice errato deve rispondere 403; con un
codice attivo deve arrivare al normale flusso di conferma. Il controllo UI è
solo ergonomia e non è il confine di sicurezza.
Procedura di riferimento: [Supabase Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).

La migration `0008_goal_time_class_contract.sql` introduce in modo staged il
vincolo `rapid|blitz`: `NOT VALID` blocca subito nuovi valori non supportati ma
lascia leggibili eventuali profili legacy. Quegli utenti vedono una scelta
esplicita e l'RPC autenticata aggiorna profilo + nuovo job in una transazione;
non viene inventata alcuna conversione da bullet/daily/classical. Dopo aver
verificato che non restano righe legacy:

```sql
select user_id, goal_time_class
from public.profiles
where goal_time_class not in ('rapid', 'blitz');

alter table public.profiles
  validate constraint profiles_goal_time_class_supported_check;
```

La quota LLM è atomica e fail-closed: per giorno UTC massimo 2 brief e 3 lezioni
per utente, con tetto globale di 15.000 invocazioni. A 15K utenti attivi il
worst case resta quindi 15.000 call pagate al giorno, non 75.000; oltre il tetto
la funzione non chiama OpenAI. Il budget reale va comunque monitorato su token,
latenza e mix brief/teach prima di aumentare i limiti.

## Deploy

Il workflow [build-and-deploy.yml](.github/workflows/build-and-deploy.yml):

- installa soltanto il frontend;
- compila con i secret pubblicabili `VITE_SUPABASE_*` e il contatto privacy;
- non esegue la pipeline Python e non genera dati di un giocatore;
- su push compila e testa senza pubblicare;
- pubblica esclusivamente `frontend/dist` su GitHub Pages solo con avvio manuale
  `workflow_dispatch`, finché i blocker di lancio qui sotto non sono chiusi.

Il deploy manuale è fail-closed. Richiede i secret `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_PRIVACY_CONTACT_EMAIL` e le repo variables
`PUBLIC_SITE_ORIGIN`, `VITE_MAIA_MODEL_URL`, `MAIA_MODEL_SHA256`; il preflight
non ne stampa i valori e interrompe il workflow se uno manca o non è valido.
`VITE_SUPABASE_ANON_KEY` accetta una publishable key `sb_publishable_...` o il
legacy JWT con ruolo `anon`; rifiuta chiavi `sb_secret_...`, `service_role`,
`supabase_admin` e valori malformati prima che possano entrare nel bundle.

### Runbook modello Maia per GitHub Pages

Il file ONNX non e' nel repository e il fallback Stockfish non sostituisce la
promessa di prodotto Maia. Prima di un deploy manuale:

1. ospita `maia3_simplified.onnx` a un URL HTTPS versionato, pubblicamente
   leggibile e con CORS compatibile con l'origine GitHub Pages;
2. configura in **Settings > Secrets and variables > Actions > Variables** la
   repo variable `VITE_MAIA_MODEL_URL` con quell'URL assoluto;
3. configura obbligatoriamente `MAIA_MODEL_SHA256` con lo SHA-256 del file e
   `PUBLIC_SITE_ORIGIN` con l'origine HTTPS pubblica (senza path). CI scarica il
   contenuto, verifica hash, redirect solo HTTPS e CORS come farebbe il browser;
4. avvia `Build & Manual Deploy` con `workflow_dispatch`. Un URL vuoto,
   irraggiungibile, senza CORS o con hash errato ferma il deploy prima del build;
5. dopo il deploy, apri una sessione e verifica che la fonte mostrata sia Maia,
   non `Stockfish di riserva`. Controlla anche cache e CORS dal browser.

Preflight locale equivalente:

```powershell
$env:VITE_MAIA_MODEL_URL='https://cdn.example.org/maia/maia3_simplified.onnx'
$env:MAIA_MODEL_SHA256='<sha256-obbligatorio>'
$env:PUBLIC_SITE_ORIGIN='https://example.github.io'
npm --prefix frontend run preflight:maia
```

Se usi lo script amministrativo `upload-maia.mjs`, passa sempre destinazione,
service key, sorgente HTTPS e hash via ambiente: `SUPABASE_REF`,
`SUPABASE_SERVICE_KEY`, `MAIA_MODEL_SOURCE_URL` e `MAIA_MODEL_SHA256` sono tutti
obbligatori. Per `raw.githubusercontent.com` la sorgente deve contenere un commit
Git completo, mai `main` o un altro branch mutabile. Lo script scarica e verifica
dimensione e SHA-256 prima della prima richiesta autenticata o modifica al
bucket; un mismatch lascia Supabase intatto.

```powershell
$env:SUPABASE_REF='PROJECT_REF'
$env:SUPABASE_SERVICE_KEY='<service-role-key>'
$env:MAIA_MODEL_SOURCE_URL='https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/<commit-git-40-char>/public/maia3/maia3_simplified.onnx'
$env:MAIA_MODEL_SHA256='<sha256-64-hex>'
node upload-maia.mjs
```

L'URL e l'hash sono pubblici e vanno in repo variables, mai nella service-role
key. Prima di distribuire i pesi resta obbligatoria la verifica licenze in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Blocker prima di operare una beta multiutente o lanciare pubblicamente

- **Licenze:** risolvere GPL/AGPL e licenza dei pesi Maia come descritto in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); la MIT root non basta.
- **Chess.com:** ottenere autorizzazione scritta oppure passare a PGN forniti
  direttamente dall'utente. Lo User Agreement corrente include restrizioni AI
  per tool educativi/prodotti concorrenti; la disponibilità della PubAPI non
  risolve da sola il conflitto. Riferimenti non legali:
  [User Agreement](https://www.chess.com/legal/user-agreement) e
  [Legal FAQ](https://www.chess.com/legal/faqs).
- **Privacy:** definire titolare e contatto reale, retention per ogni categoria,
  processor/trasferimenti (Supabase e OpenAI), policy minori/età e base/decisione
  per l'analisi di profili Chess.com di terzi. Configurare la cancellazione
  programmata degli eventi anonimi e verificare export/cancellazione end-to-end.
- **Controlli hosted:** attivare e provare il Before User Created hook, impostare
  origin esatti e header IP fidati, ruotare eventuali credenziali storiche e
  completare la rimozione dei dati personali dalla storia Git.

Questa è una checklist tecnica, non un parere legale.
Il gate invite-only è un controllo operativo e non rende lecito l'accesso API:
il punto Chess.com va risolto prima di coinvolgere utenti reali nella beta.

Prima di rendere pubblico un repository nato come progetto single-user, rimuovi
anche gli artefatti personali già presenti nella storia Git e verifica che
nessuna credenziale storica sia ancora valida. Il working tree corrente non
contiene più i dataset legacy sotto `data/` o `frontend/public/`; non è stata
invece riscritta la cronologia Git, operazione distruttiva da fare soltanto con
consenso esplicito. `.gitignore` impedisce nuovi artefatti, ma non cancella i
blob già committati dalla cronologia.

## Struttura utile

```text
frontend/src/
  auth/                 sessione, RLS types, Storage, account lifecycle
  pipeline/             import, analisi e aggregazione browser-side
  session/              sessione quotidiana, drill e memoria locale
  pages/                Landing, Stanza, Tavolo, Quaderno, Settings
  lib/telemetry.ts      analytics first-party, feedback ed error reporting
  trainingProgress.ts   append tentativi e transfer osservato
supabase/
  migrations/           schema e policy RLS
  functions/            coach-llm, account-data, telemetry
backend/                toolchain Python legacy/ricerca
```

## Metriche di prodotto

Definizioni, soglie e SQL canonici sono in
[docs/PRODUCT_METRICS.md](docs/PRODUCT_METRICS.md).

Le metriche principali non sono il numero di analisi prodotte, ma:

- tempo al primo insight personale;
- prima sessione completata;
- retention D7/W4;
- successo su nuove posizioni dello stesso pattern;
- riduzione degli errori nelle opportunità osservate in partite successive.

Queste misure chiudono il ciclo `diagnosi → esercizio → transfer`, che è il
cuore del prodotto.
