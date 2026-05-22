# SaaS Transition · Piano di battaglia

> Da v2 personal tool (gh-pages, single-user, hardcoded) a v3 SaaS
> multi-tenant con pricing, auth, backend hosted.
>
> **Stato**: v2 deployata su gh-pages. Funziona per 1 utente (breaking_plays2).
> **Obiettivo MVP SaaS**: 6 settimane intense. Primo utente paying al m6.

---

## 1. Le 8 decisioni da prendere ORA (10 minuti)

Sono decisioni che bloccano l'inizio. Le facciamo velocemente, poi
parte tutto. Per ogni decisione ti do la **mia raccomandazione**.

### D1 — Nome del prodotto + dominio
La cosa che blocca tutto. Tutto il resto dipende dal nome.

Opzioni:
- **`chesspath.io`** — il "percorso" verso il rating target. ⭐ raccomando.
- `chesscoach.io` — già preso (.com è di un coach umano fiorentino, .io
  da verificare)
- `maiacoach.io` — gioca su Maia integrata ma è insider, no SEO
- `risechess.io` / `chessrise.io` — semplice, claim chiaro
- `mygotham.io` — nome corrente, fa vibe da Batman, può funzionare

Cosa fare appena scelto: **registra il dominio su Cloudflare** (~$10/anno).

### D2 — Stack backend
Mio voto: **FastAPI + Postgres**.

Alternative:
- FastAPI + Turso (SQLite distribuito) — più leggero ma meno strumenti
- Django — pesante, troppo overhead per un MVP
- Node/Express + Prisma — TS end-to-end ma lo stack chess Python è migliore

Vantaggio FastAPI: tutto il backend Python esistente (Stockfish/Maia
inferenza, player_model.py) si porta via.

### D3 — Database
Mio voto: **Supabase Postgres** (free tier 500MB, ottimo per partire).

Alternative:
- Neon (Postgres serverless, free generoso)
- Turso (SQLite distribuito, free generoso, sotto stress)
- Railway Postgres (a pagamento subito)

Schema multi-tenant: ogni tabella ha `user_id`. RLS (Row Level Security)
abilitato a livello Postgres per isolamento garantito.

### D4 — Hosting backend
Mio voto: **Render.com** (free tier per partire, $7/mese il primo plan
pagato).

Alternative:
- Fly.io (free tier ma più complesso, scala meglio)
- Railway ($5 di credito/mese, semplice)
- Heroku (no free tier, ma robusto)

Render fa il deploy automatico da git push, ha worker dyno per long
jobs (Stockfish), ha Postgres add-on.

### D5 — Hosting frontend
Mio voto: **Vercel** (free per progetti personal, ottimo Vite support).

Sostituiamo gh-pages con Vercel. Gh-pages resta come "demo statica
single-user" per ora, magari come `demo.<dominio>` per landing.

### D6 — Auth
Mio voto: **Clerk** (free fino a 10k MAU, DX top, login social + email
out-of-the-box).

Alternative:
- Supabase Auth (incluso se prendiamo Supabase Postgres) — più scomodo
  ma 1 servizio in meno
- Auth0 (overkill costoso)
- NextAuth (non lo uso, è per Next.js)

Su Clerk metti email + Google + GitHub. Niente Chess.com OAuth perché
NON esiste pubblico.

### D7 — Pagamenti
**Stripe** (no alternative serie).

Test mode mentre sviluppiamo. Live mode al lancio.

### D8 — Repo strategy
Mio voto: **monorepo** con riorganizzazione:

```
chess_coach/                              ← il repo attuale, rinominato
├── apps/
│   ├── web/                              ← frontend (era frontend/)
│   ├── api/                              ← FastAPI backend (NEW)
│   └── worker/                           ← Stockfish/Maia jobs (NEW)
├── packages/
│   ├── shared/                           ← types condivisi TS<->Python (NEW)
│   └── chess_engine/                     ← logica Stockfish/Maia (era backend/)
├── docs/                                 ← spec, vision, transition
└── .github/workflows/                    ← CI
```

Repo resta pubblico (front + backend code), `coach_brain/` resta
privato come ora. Dati utenti vivono solo su Postgres (mai in repo).

---

## 2. Cosa setti TU questa settimana (account esterni)

Mentre io ristrutturo il codice, tu apri questi account. Costa 0 per
ora (tutti free tier):

### Da fare nell'ordine

1. **Registra il dominio** (~$10/anno). Cloudflare Registrar consigliato.
   - Vai a <https://dash.cloudflare.com/?to=/:account/registrar>
   - Cerca il nome scelto in D1
   - Registra (1 anno minimo)
   - Lascia DNS su Cloudflare (lo useremo)

2. **Account Vercel** (free)
   - <https://vercel.com/signup> con GitHub login
   - Crea team personale (default ok)
   - Una volta dentro: "Import Project" da `leandronesi/chess_coach`,
     directory `apps/web`, ma NON pubblicare ancora (lo faccio io dopo
     ristrutturazione)

3. **Account Render** (free)
   - <https://dashboard.render.com/register> con GitHub login
   - Connect repo `leandronesi/chess_coach`
   - Aspetta il mio "deploy ora", ti dico io quando

4. **Account Supabase** (free)
   - <https://supabase.com/dashboard/sign-up>
   - Crea progetto: `chesspath-prod` (o nome scelto)
   - **Salva**: `Project URL` + `anon key` + `service_role key` (mai
     committarli, li metti su Render+Vercel come env var)
   - DB region: **eu-central-1** (Francoforte, vicino a noi)

5. **Account Clerk** (free fino a 10k MAU)
   - <https://dashboard.clerk.com/sign-up>
   - Crea application: `chesspath` (dev environment per ora)
   - Abilita providers: Email, Google, GitHub
   - **Salva**: `Publishable Key` + `Secret Key`

6. **Account Stripe** (free in test mode)
   - <https://dashboard.stripe.com/register>
   - Per ora non serve KYC business, basta personale
   - Stai in **Test Mode**, crei i 2 prodotti che ti dico io (Pro €8, Coach €25)
   - **Salva**: `Publishable Key (test)` + `Secret Key (test)` + i 2
     `Price ID`

7. **Account OpenAI** (già fatto)
   - Hai già la `OPENAI_API_KEY` per il coach LLM.
   - Verifica budget: $20-50/mese coprono i primi 100 utenti.

Quando hai aperto i 7 account e raccolto le credenziali, mandami il
messaggio "**setup done**" e io comincio l'implementazione.

---

## 3. Roadmap 6 settimane

### Settimana 1 — Fondazione backend (io)
- **Lun-Mar**: monorepo restructure, FastAPI scaffold, DB schema multi-tenant
  con Alembic migrations.
- **Mer-Gio**: porting Stockfish/Maia analysis come **job async** (RQ + Redis
  o Celery). Worker dyno su Render.
- **Ven**: endpoint `/api/me/ingest` che triggera pipeline per un nuovo
  username Chess.com. Test end-to-end con 1 utente.
- **Sab-Dom**: integrazione Clerk auth, endpoint protetti, RLS Postgres.

**Milestone S1**: un utente test si autentica → inserisce username Chess.com
→ il backend analizza e produce `player_model.json` per quel `user_id`.

### Settimana 2 — Frontend tenant-aware (io)
- Riorganizzo `apps/web/` per leggere da API invece di file statico
- Aggiungo Clerk SDK frontend: login/signup/profile
- Tenant context (current user → API calls authenticated)
- Stato "in onboarding" (sto scaricando partite) → polling status
- Mantengo le 5 viste della v3 (HOME / PROFILO / PATTERN / REPERTORIO /
  PROGRESSO)

**Milestone S2**: signup → onboarding → dashboard funzionante per N utenti
distinti. Dati isolati.

### Settimana 3 — La v3 vera (io)
- Difficoltà come moneta: re-inferenza Maia con multipv=20, schema DB
  esteso con `difficulty`, `expected_correct_*`
- Pattern detection tattica (python-chess euristica)
- Vista PATTERN nel frontend
- Coach LLM riscritto per parlare in linguaggio v3

**Milestone S3**: aprire la PATTERN view e vedere "Forchetta del cavallo:
12 errori, gap +45pp vs target 1600". Frasi narrative dal LLM.

### Settimana 4 — Stripe + paywall (io)
- Integration Stripe Subscriptions (Pro €8, Coach €25)
- Free tier limiti hardcoded (1 ingest/giorno, 5 drill/mese, no coach LLM)
- Paywall su feature Pro (modal "upgrade")
- Webhook Stripe → aggiorna `subscription_status` in DB
- Stripe Customer Portal (per cancellare/cambiare piano)

**Milestone S4**: utente paga €8 via Stripe → vede le feature Pro sbloccate.

### Settimana 5 — Repertorio + Spaced Repetition (io)
- Albero PGN delle aperture con confronto Lichess Explorer
- Vista REPERTORIO
- Memory queue per pattern errati (algoritmo FSRS o SM-2)
- "Curriculum settimanale" base: la sessione cambia in base al pattern
  dominante della settimana

**Milestone S5**: la sessione guidata propone puzzle dello stesso pattern
ricorrente, ogni giorno scala difficoltà.

### Settimana 6 — Launch readiness (insieme)
- Landing page su `<dominio>.com` (Vercel)
- Onboarding flow polished (tutorial 3 step)
- Bug fix + load test (50 utenti simultanei)
- SEO base + Open Graph
- Lista beta: 20-30 amici/Twitter per smoke test
- **Soft launch**: posta su Twitter/Reddit r/chess

**Milestone S6**: primo utente pagante.

---

## 4. Cosa farai TU mentre io codo (al di là dei setup)

Cose che NON posso fare io e che devono andare avanti in parallelo:

### Setting marketing
- **Twitter account** per il prodotto (es. `@chesspath_io`). Inizia a
  postare i grafici della v2 (con dei tuoi numeri) per fare hype. 1
  post a settimana.
- **Connessioni Chess YouTube**: identifica 5 micro-influencer
  (Eric Rosen, Andrea Botez, Daniel Naroditsky probabilmente non
  rispondono, ma sono punti di mira). Sotto: chiunque con 50k-500k iscritti
  che fa "improvement" content è target perfetto per partnership.
- **Discord chess server presence**: scoprire dove vivono i 1100-1800
  online (Chess.com Club, Lichess Discord, Reddit r/chess). Diventa
  attivo per 4 settimane, non spam, contributi reali.

### Contenuto
- **Demo video** (60 secondi) del prodotto v2 — anche solo Loom screen
  recording — che mostri "rating attuale → curva → drill → recap".
  Tieni pronto per al lancio.
- **Articolo SEO**: "Why ACPL is lying to you (and what to measure
  instead)". 1500 parole, in inglese, link al tuo sito. Posto su Medium
  + crosspost Reddit.

### Business
- **Apri P. IVA** (se non già) o registrazione come "lavoratore autonomo
  occasionale" per le prime entrate Stripe.
- Decidi se: persona fisica (limite €5000/anno reddito occasionale) o
  ditta individuale o Srls. Da chiedere a commercialista — non perdere
  tempo qui adesso, basta che Stripe possa pagarti in qualche modo.

---

## 5. Le PRIME 3 AZIONI concrete (oggi)

Tu, ora:
1. **Decidi il nome** in D1 (10 secondi). Mandami "Nome: X" e procediamo.
2. **Apri Cloudflare** e registra il dominio. ~3 minuti, $10.
3. **Apri Vercel + Render + Supabase + Clerk + Stripe** (i 5 account in §2).
   ~30 minuti totali, tutto free. Salva le credenziali in un password
   manager o file `.env.example.production` (mai committare il vero!).

Io, ora:
1. Aspetto il tuo "Nome: X" + "setup done".
2. Comincio il monorepo restructure (~4 ore di lavoro).
3. Setto FastAPI scaffold + DB schema (~6 ore).

Tempo totale per arrivare alla milestone S1 (utente test che si
autentica): **5-7 giorni di mio lavoro intenso**, in parallelo coi tuoi
setup esterni.

---

## 6. Quando devo aspettarmi soldi sul conto

Realistico, no bullshit:

- **Settimana 6 (lancio soft)**: 5-10 signup beta gratuiti, di cui 1-2
  convertono a Pro per supportarti. €8-25/mese MRR.
- **Mese 3**: 50-100 utenti, di cui 5-10 Pro. €40-100 MRR.
- **Mese 6**: 200-500 utenti, di cui 30-50 Pro. €250-500 MRR. Inizi a
  vivere col prodotto (parzialmente).
- **Mese 12**: 1000-3000 utenti, di cui 150-300 Pro. €1.5k-3k MRR.
  Diventa il tuo lavoro a tempo pieno se ci credi.
- **Mese 18 (moonshot)**: 5k-10k utenti Pro = €40k-80k MRR. **Acquisition
  Chess.com o standalone profitable.**

Le proiezioni sono ottimistiche ma realistiche per un prodotto B2C
chess con un differenziale chiaro. Per arrivarci serve disciplina di
esecuzione + content marketing in parallelo allo sviluppo.

---

## 7. Cosa NON facciamo nelle prime 6 settimane

Tentazioni di scope creep. Dico già di NO a:

- ❌ **Mobile app native**. Web responsive prima.
- ❌ **Chat conversazionale live**. Coach narrativo statico per ora.
- ❌ **Integrazione live durante partita** (overlay browser). Dopo.
- ❌ **Multi-lingua**. Italiano + Inglese. Basta.
- ❌ **Tournament mode / team / community features**. Distrazione.
- ❌ **Custom domain per ogni coach (white label)**. Pricing tier ma
  feature deep dopo M2.
- ❌ **Analytics avanzata custom dashboards utente**. Quello che c'è basta.

Se durante le 6 settimane viene voglia di farne una di queste, **scrivi
in una TODO future-features.md** e vai avanti. Disciplina.

---

## 8. Il primo messaggio dopo che hai letto tutto

Mandami:

```
Nome: <chesspath / chesscoach / mygotham / ...>
Dominio: <dominio.io|com>
Setup esterni: <fatto / faccio entro stasera / faccio domani>
```

Appena ho questi 3 dati, parto col monorepo restructure e tu hai 24-48
ore di setup esterni in parallelo. Lunedì sera abbiamo già:
- Repo riorganizzato
- FastAPI scaffold girante in locale
- Postgres Supabase connesso
- Clerk auth integrato sul frontend
- Domain pointing a Vercel placeholder

Da lì in 3-4 giorni: il primo utente diverso da te si autentica e vede
la sua dashboard.

**Andiamo**.
