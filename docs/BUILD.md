# BUILD — la storia dell'utente nel tempo

> v1 · 2026-05-29 · Spec operativa di sviluppo, scritta dopo il pitch (`docs/pitch/`).
> Modello di lavoro: **Opus dirige (questa spec, la verifica), Sonnet esegue.**
> Regola d'oro: la **build resta verde** ad ogni fetta. Niente regressioni sull'app esistente.

---

## 0. Dove siamo (dal censimento del codice, 2026-05-29)

La fondazione c'e' ed e' buona:
- Multi-utente Supabase (auth email + invite-code beta), `profiles` con goal completo
  (`goal_rating`, `goal_deadline`, `goal_horizon_weeks`, `goal_time_class`, `weekly_minutes`,
  `onboarding_state`), `games`, `ingest_jobs`. RLS ovunque. Storage bucket `user-data`.
- Pipeline resumable: ingest -> analyze (Stockfish browser) -> aggregate (Maia browser) -> coach (best-effort) -> ready.
- **Maia gia' computato E persistito** in `quaderno/aggregates.json`: `drill_value`, `move_difficulty`,
  `p_maia_mine_top`, `p_maia_target_top`, `priority_score`, `maia_weighted`, `anchors[]`.
- Superfici: **Sessione 100%** (4 fasi: guardo / aiuto / da solo / partita vs Maia@target gia' nel browser).
  **Tavolo ~85%** (NonnoGreeting+frustata, anello obiettivo, gap col target, GameArc, SpeedVsErrors, cadute).
  **Quaderno ~50%** (cadute + repertorio, ma "ridondante", manca la struttura a backstage).

**L'unico buco strutturale = la DIMENSIONE TEMPORALE.** `aggregates.json` e' sempre sovrascritto
(stato presente). Non esiste storia, ne' traguardi, ne' "punti deboli che migliorano". Questo e'
il pezzo mancante, ed e' precisamente cio' che chiede il PO e cio' che regge "LA PROVA" del pitch.

---

## 1. Il modello: la storia dell'utente (i sostantivi nel tempo)

Quattro oggetti temporali, costruiti SOPRA i dati che gia' esistono. Sono il cuore della retention.

### 1.1 Obiettivo (esiste, va solo esposto meglio)
`Goal`: da rating attuale a target entro deadline. Gia' calcolato (`playerModelLite.computeGoal`).
Aggiungere la lettura azionabile: **punti/settimana necessari vs reali**, proiezione, `on_track`.
Superficie: Tavolo (anello, gia' c'e') + Quaderno/Evoluzione (proiezione).

### 1.2 Punti deboli che migliorano (= Ancore nel tempo) — IL CUORE
Per ogni **Ancora** (debolezza ricorrente verso il target), il suo andamento:
"Pezzo in presa: 4 settimane fa lo evitavi il 19%, oggi il 34%, il target e' 67%."
Due fonti, complementari:
- **Trend immediato (finestrato)**: calcolato SUBITO dai dati gia' analizzati, dividendo le
  posizioni di quell'ancora per **finestra temporale della partita** (ultime ~4 settimane vs le ~4
  precedenti). Da' un segnale direzionale al primo giorno, senza aspettare. Con guardia di numerosita'.
- **Storia (snapshot)**: serie autoritativa che si accumula nel tempo (vedi §2.2), prevale quando
  esistono >= 2 snapshot.
Superficie: Quaderno/Evoluzione (curva per ancora) + citata da Nonno sul Tavolo quando migliora.

### 1.3 Traguardi (Milestone) — derivati, deterministici
NON una tabella di eventi ad-hoc: **derivati deterministicamente** dalla storia + goal + drill log.
Tipi: `rating_gain` (+25/+50/+100 dall'inizio), `gap_closed` (pp di gap col target chiusi),
`anchor_improved` (un'ancora migliorata di >= X pp), `anchor_domata` (uscita dalla top / count crollato),
`sessions` (sessioni fatte, da drill log), `on_track` (proiezione >= target raggiunta).
Ognuno: stato (raggiunto / in corso con %), evidenza (il numero che lo prova), data.
Superficie: Quaderno/Traguardi + "scintilla" sul Tavolo quando fresco (<= 7gg).

### 1.4 Storia (timeline)
Rating curve (gia' c'e') + diario di Nonno (`coach_journal.md`, append-only, gia' c'e') resi una
timeline navigabile. Superficie: Quaderno/Storia.

---

## 2. Decisioni sul data layer (il come)

Coerenti coi pilastri: **filesystem-as-infrastructure** (file JSON in Storage, non nuove tabelle SQL
salvo necessita'), **aggregator deterministico** (i traguardi si calcolano, non si "scrivono a mano"),
zero-worker (tutto browser-side, persistenza su Storage).

### 2.1 Trend finestrato (immediato) — in `aggregate.ts`
Vincolo onesto: oggi teniamo solo le posizioni di ERRORE (cadute). Quindi la "percentuale di volte che
trovi la mossa" (stile pitch 19% -> 34%) NON e' calcolabile subito (servirebbe censire anche le
occorrenze NON-errore del pattern: estensione di `analyze`, rimandata e annotata). Il trend immediato
disponibile e' la **FREQUENZA dell'errore** dell'ancora, normalizzata per partite, in due finestre sulla
**data della partita**: `recent` (<= 28 gg dall'ultima partita) vs `prior` (29..56). Piu' raro = stai
migliorando. Espone su `Anchor`:
```ts
trend_now?: {
  recent_per_game: number | null;   // occorrenze ancora / partite, finestra recente
  prior_per_game: number | null;
  recent_n: number; prior_n: number;        // occorrenze (errori) nelle due finestre
  recent_games: number; prior_games: number; // partite distinte nelle due finestre
  target_pct: number | null;         // media p_maia_target_top sull'ancora (quanto e' "da target")
  direction: "improving" | "worsening" | "stable";  // recent_per_game < prior_per_game => improving
  confidence: "low" | "medium" | "high";     // da min(recent_n, prior_n) e dal n. partite
}
```
Null se dati insufficienti. NON inventare: sotto soglia -> `confidence:"low"` o `null`.
La "findability" stile 19->34 arriva dalla STORIA (snapshot accumulano `mine_pct`/`target_pct` per ancora,
§2.2): prevale quando ci sono >= 2 snapshot.

### 2.2 Storia (durevole) — `quaderno/history.json` in Storage
Un SOLO file, array append-only di snapshot COMPATTI (niente `examples`, solo cio' che serve a trend e
traguardi). Scritto a fine di OGNI run (onboarding/refresh/reanalyze), **best-effort** (try/catch,
non blocca mai `ready`, come il coach). Dedup per `week_iso` (un punto per settimana: l'ultimo vince).
Tieni gli ultimi ~52.
```ts
interface HistorySnapshot {
  captured_at: string;          // ISO
  week_iso: string;             // "2026-W22"
  run_kind: "onboarding" | "refresh" | "reanalyze";
  games_analyzed: number;
  rating_by_time_class: Record<string, number | null>;
  goal: { target: number; time_class: string; current: number | null;
          points_needed: number; days_left: number; on_track: boolean;
          projection_at_deadline: number | null };
  maia_weighted: { errors_scored: number; avoidable: number; mine_pct: number | null;
                   target_pct: number | null; gap_pct: number | null; avoidable_share: number | null };
  anchors: Array<{ key: string; label_it: string; count: number;
                   mine_pct: number | null; target_pct: number | null; rating_upside: number }>;
}
interface HistoryFile { schema_version: 1; snapshots: HistorySnapshot[]; }
```

### 2.3 Derivazioni deterministiche — `pipeline/history.ts` (nuovo)
Funzioni pure, niente LLM:
- `readHistory(userId)` / `appendSnapshot(userId, snap)` (dedup per settimana).
- `anchorTrendsFromHistory(history)` -> serie per ancora (prevale su trend_now se >=2 snapshot).
- `computeMilestones({ history, goal, aggregates, drillLog })` -> `Milestone[]` (raggiunti + in corso).
- `goalProgress(goal)` -> `{ points_needed, weeks_left, rate_needed_per_week, rate_real_per_week, on_track, projection }`.

### 2.4 Quando NON servono tabelle SQL
Tutto sta in Storage JSON + derivazioni a runtime. Milestone e trend sono **calcolati**, non persistiti
come eventi. (Se un domani servisse query cross-utente, si valutera' una tabella; per ora no.)

---

## 3. Le fette (sequenza, ognuna build-verde)

### SLICE 1 — Fondazione temporale (NESSUNA UI; sicura, additiva)
- `types.ts`: aggiungi `Anchor.trend_now`, `HistorySnapshot`, `HistoryFile`, `Milestone`, `GoalProgress`.
- `aggregate.ts`: calcola `trend_now` per ancora (finestre 28/28 gg su data partita, con confidence).
- `pipeline/history.ts` (nuovo): `readHistory` / `appendSnapshot` (dedup week) / `anchorTrendsFromHistory`
  / `computeMilestones` / `goalProgress`. Funzioni pure + I/O Storage isolato.
- `orchestrator.ts`: dopo aggregate+playerModel, **append snapshot best-effort** (try/catch, mai blocca).
- **Acceptance**: `npm run build` verde; nessun cambiamento visibile; un run scrive `history.json`;
  un secondo run aggiunge/sostituisce lo snapshot della settimana. `trend_now` popolato dove c'e' dato.

### SLICE 2 — Tavolo: esponi obiettivo + ancore + "stai migliorando"
- Sezione **"Le tue 3 ancore"** ordinate per `rating_upside` (oggi solo citate da Nonno).
- Riga **progresso verso l'obiettivo**: "servono +2.9/sett, vai a +1.2" (da `goalProgress`).
- NonnoGreeting: se un'ancora top ha `trend_now` in miglioramento, una variante "stai andando".
- **Acceptance**: build verde; Tavolo mostra le 3 ancore by upside + la riga progresso; nessun dato finto.

### SLICE 3 — Quaderno = backstage vero (la storia)
- Riorganizza in tab: **Evoluzione** (ancore nel tempo + proiezione obiettivo) · **Traguardi**
  (milestones) · **Storia** (rating curve + diario Nonno) · **Profilo** (decisioni/tempo/tilt, spostati
  qui dal Tavolo) · **Cadute** (esiste) · **Repertorio** (esiste). Ancore ordinate per upside.
- Cross-linking OOUX: da un'Ancora ai suoi Momenti; da un Momento alla sua Apertura.
- Riusa i componenti gia' disaccoppiati (RatingCurveChart, DecisionsCard, SpeedVsErrorsChart, WeeklyTrendCard,
  CadutaCard, RepertorioPanel) spostandoli nelle tab giuste. Niente piu' ridondanza col Tavolo.
- **Acceptance**: build verde; Quaderno non duplica il Tavolo; Evoluzione mostra trend (o "prima misura,
  torna dopo la prossima analisi" se <2 dati); Traguardi mostra milestone reali.

### SLICE 4 — Sessione: mossa di attesa + rifinitura
- `waiting_moves` (alternative Stockfish-validate, cp_loss<50, non forzanti) quando la mossa giusta e'
  troppo difficile (`p_maia_mine_top < 0.20`): calcolo in analyze/aggregate + uso in MomentReview/WarmupGuidato.
- Esponi `drill_value` esplicito in MomentReview ("questa la trova il 67%, tu il 34%").
- **Acceptance**: build verde; quando la mossa e' troppo difficile, Nonno propone la mossa di attesa.

### Dopo le fette: giro di polish UI/UX congiunto (impeccable) + redeploy coach-llm.

---

## 4. Invarianti (hard, ad ogni fetta)
1. `cd frontend && npm run build` **verde** (TS strict). Mai consegnare rosso.
2. Persistenze nuove **best-effort** (try/catch): non bloccano mai `onboarding_state=ready`.
3. RLS rispettata: ogni file Storage sotto `<user_id>/...`. Zero worker server-side.
4. Voce: una sola (Nonno, seconda persona). Lessico italiano vero. "Ancore", mai "freni".
5. Design: regole `docs/DESIGN.md` (oro solo per l'Obiettivo, twilight <=15%, flat, niente em-dash,
   niente card-dentro-card, un CTA per schermo).
6. Niente numeri finti: sotto-soglia -> stato "dato insufficiente", mai inventare un trend.

---

## 5. FASE 2 — La parte fica: redo UI/UX a livello pitch

> Questo e' il finale atteso dal PO: portare OGNI superficie all'anima e alla qualita' del pitch
> (`docs/pitch/`). NON si ri-decide la UX (gia' scolpita: 3 superfici, Sessione 4-fasi, OOUX, la voce).
> Si rifa' l'ESECUZIONE visiva/esperienziale. Le skill di design (impeccable) si usano per POLISH UI,
> mai per UX redo (regola PO).

### 5.0 Diagnosi del sistema visivo attuale (da `frontend/src/index.css`, 6836 righe)
I **token sono giusti** (stessa palette del pitch: notte, twilight, miele, 3 livelli surface, light/dark).
Ma l'esecuzione e' **derivata e contro le regole di DESIGN.md**:
- `.display-rating` usa **gradient-text** (`-webkit-background-clip:text`) -> VIETATO. Va a colore solido.
- **box-shadow decorative** diffuse (`.surface`, `.hero`, bottoni) -> DESIGN.md = FLAT (profondita' = strati tonali). Le ombre solo funzionali (focus / elemento davvero sollevato).
- CTA `.home-session-button` = **gradiente verde->blu**, fuori palette -> deve essere **twilight** (un solo CTA per schermo).
- **Sprawl**: troppe classi bespoke `.home-*`/`.trainer-*`, gradienti su brand-mark e bottoni.
Conseguenza: il redo e' **disciplina + ricomposizione**, non ripartenza da zero.

### 5.1 Metodo (sicuro, niente big-bang)
1. **Kit canonico ADDITIVO**: introduci un set di classi disciplinate allineate a `docs/pitch/assets/pitch.css`
   (voce di Nonno, hero-Obiettivo, chip, stat, board-frame, chart, motion) SENZA rimuovere subito il legacy.
2. **Redo superficie-per-superficie** sul kit; ritira le classi legacy di quella superficie quando e' fatta.
3. **Build-verde + sanity visiva** ad ogni superficie. Niente cambiamento globale rischioso in un colpo.
4. Skill `impeccable` solo per il polish UI per-superficie (mai redo UX, mai distill/shape/craft non richiesti).

### 5.2 Le superfici (i data-slice §3 si FONDONO qui: dati + UI insieme per superficie)
Sequenza che SOSTITUISCE l'ordine §3 (i task-dati restano quelli, ma si consegnano con la loro UI):
- **S1 (in corso)** Fondazione temporale (solo dati, nessuna UI). Vedi §3 SLICE 1.
- **S2 · Design-system**: kit canonico + fix disciplina sicuri (gradient-text -> solido; shadow decorative -> tonale; CTA -> twilight; oro SOLO per l'Obiettivo). Build verde, nessuna regressione funzionale.
- **S3 · TAVOLO** (dati: 3 ancore by-upside + riga progresso + trend "stai migliorando"; UI: ingresso = frustata di Nonno DOMINANTE, rituale, una sola CTA "Sediamoci", densita' calma).
- **S4 · QUADERNO** (dati: Evoluzione/Traguardi/Storia/Profilo; UI: il backstage, archivio calmo navigabile, cross-link OOUX, niente ridondanza col Tavolo).
- **S5 · SESSIONE** (dati: waiting_moves + drill_value esplicito; UI: rituale guidato 4-fasi, board-centrico, Nonno presente in ogni fase, una azione per volta).
- **S6 · SHELL**: Landing + Auth + Onboarding + nav + motion + light/dark + mobile, all'anima del Tavolo (prima impressione = "un tavolo a cui ti siedi", non una dashboard).
- **S7 · Polish congiunto** (`impeccable`) + redeploy `coach-llm` (cap 50).

### 5.3 Acceptance per superficie (oltre agli invarianti §4)
- Rispetta DESIGN.md: FLAT, twilight <= 15% della superficie, ORO solo per l'Obiettivo, niente gradient-text,
  niente em-dash, niente card-dentro-card, niente side-stripe, UNA CTA per schermo.
- Una sola voce (Nonno, seconda persona). Lessico italiano vero. "Ancore", mai "freni".
- Mobile + light/dark verificati. Nessun dato finto.
- Stella polare: **non una dashboard, un tavolo a cui ti siedi la sera.** Spazio, calma, la voce, un gesto.

---

## 6. ROUND 2 — anima + esperienza (feedback PO 2026-05-30)

> Il PO, guardando l'app, ha detto "sembra identica a prima". Causa #1 trovata: la stava vedendo in
> LIGHT (l'app seguiva il prefers-color-scheme di sistema). L'anima del Tavolo vive nel DARK.
> Direzione PO: "ripensa Cadute e Quaderno come ESPERIENZA, non liste". Round 2 alza l'anima e
> re-immagina le superfici deboli.

### 6.1 Dark-default (FATTO)
`theme.ts`: il default e' DARK (prodotto notturno per design); il chiaro solo se l'utente lo sceglie
esplicitamente. Niente auto-follow del sistema verso il light.

### 6.2 Repertorio: via "Unknown" subito
`RepertorioPanel`: se `opening` e' null/"Unknown" ma `eco` c'e', mostra il nome via una util
`ecoName(eco)` (mappa dei codici ECO comuni 1000-1800 -> nome famiglia: C25/C28 Viennese, B01 Scandinava,
B00 Apertura di re, B10 Caro-Kann, B20/B2x Siciliana, C00/C0x Francese, D00 di Donna, A00 irregolari, ecc.).
Fallback "Apertura ECO {code}". (Il nome preciso da ECOUrl arriva con la rianalisi: questo e' il display immediato.)

### 6.3 Traguardi: niente lista meccanica di soglie
Oggi mostra +25 e +50 entrambi con evidenza "+95" (rumore). Ridisegna: UN traguardo raggiunto rilevante
(la soglia piu' alta superata, "hai gia' passato +50, sei a +95") + IL PROSSIMO in corso ("+100 al 95%"),
con la voce di Nonno che celebra. Dedup per tipo, mostra il piu' rilevante + next, non una riga per soglia.
`computeMilestones` resta; cambia solo la presentazione.

### 6.4 Tavolo: nav su, non in fondo
Sessione/Quaderno non sepolti in fondo: link accessibili in alto (header sticky accanto a "Esci" oppure
subito sotto la voce di Nonno). Una sola CTA primaria ("Sediamoci"); Sessione/Quaderno nav secondaria ma
VISIBILE senza scrollare.

### 6.5 Quaderno: voce + bold (esperienza, non tabelle)
Ogni tab si apre con una riga di NONNO (la sua lettura di quella vista), type piu' editoriale.
Evoluzione e Storia come MOMENTI raccontati, non liste fredde.

### 6.6 CADUTE = TRAINER A FLASHCARD (il pezzo grosso, spec del PO)
Da galleria di scacchiere a **trainer graduato, raggruppato per ancora/pattern**. La galleria d'ingresso
mostra i gruppi (es. "Pezzo in presa · 12", "Ottava traversa · 7", "Varie") con un "Allena" per gruppo.
Dentro un gruppo, un drill in **3 fasi** sulle posizioni di quel pattern. La mossa dell'AVVERSARIO sempre
chiara dove e' mostrata.
- **Fase 1 · GUARDA (scarrellata):** carosello delle posizioni; ognuna con la mossa dell'avversario (freccia)
  + la mossa giusta (freccia/evidenza) + una riga di Nonno. Solo guardare: costruisci il riconoscimento.
- **Fase 2 · CON L'AVVERSARIO:** mostra la mossa dell'avversario, nascondi la mossa giusta; TU giochi sulla
  scacchiera. Valuta con Stockfish il cp_loss della tua mossa:
    perfetta (= best / cp_loss ~0) -> "si'";
    ABBASTANZA BUONA (cp_loss < ~50) -> mossa accettata MA AVVERTITO ("buona, ma c'era di meglio: X");
    sbagliata (cp_loss alto) -> FATTO NOTARE ("no: era X").
- **Fase 3 · DA SOLO (cieco):** posizione SENZA la mossa dell'avversario; TU giochi. Stessa valutazione
  "good enough" + feedback.
- Principio: non serve la mossa perfetta, basta una **abbastanza buona**; ma se non e' perfetta vieni
  avvertito, se e' sbagliata ti viene fatto notare.
- Tecnica: `useStockfish` per cp_loss della mossa utente; `BoardView` interattivo; dati posizione
  (fen_before, best_uci/best_san_sf, last_opp_from/to). Soglie con buon senso (buona < 50cp, sbagliata >= 50/soglia mistake).
- Riusa il piu' possibile i mattoni della Sessione (board, valutazione, voce di Nonno). Niente dato finto.

### Acceptance Round 2: build verde · DARK e' il default · Repertorio niente "Unknown" · Traguardi sensati
· nav del Tavolo in alto · Quaderno con voce · Cadute = trainer 3 fasi funzionante (anche con poche posizioni, empty-state onesto).

### 6.7 REPERTORIO: da numero a NAVIGABILE (drill-into) — Round 3
Problema (PO, 2026-05-30): "5 errori evitabili in 5 partite della Francese" e' inutile. Servono due cose:
(1) vedere le PARTITE / la successione di mosse; (2) sapere DOVE sta l'errore (apertura vs mediogioco vs
finale). Un errore "nella Francese" puo' essere un problema di mediogioco/struttura/finale, NON di teoria:
l'etichetta-apertura da sola inganna.
Fix: click su un'apertura -> dettaglio (riusa BoardView + lo stile cadute):
1. RIPARTIZIONE PER FASE degli errori evitabili di quell'apertura: "X in apertura · Y in mediogioco · Z in
   finale" (dalle cadute filtrate per eco). E' IL segnale: dice se il problema e' davvero la teoria o cosa viene dopo.
2. LE POSIZIONI CRITICHE di quell'apertura (cadute filtrate per eco): mini board + contesto mosse
   (prev_moves -> tua mossa -> mossa giusta) + chip FASE + link "apri la partita" (url Chess.com) + riga di Nonno.
3. Voce di Nonno che inquadra: se la maggioranza degli errori e' fuori apertura, lo dice
   ("non e' la teoria, e' cosa fai dopo: la struttura").
Dati: usa RepertoireOpening.positions se presente; altrimenti JOIN deterministico: filtra
aggregates.cadute/examples per `eco`. Le cadute hanno eco/opening/phase/san/prev_moves/fen_before/url. Niente dato finto.
Sequenza: parte DOPO il Round 2 (che da' i nomi ECO), perche' estende lo stesso RepertorioPanel.
(Visione futura, non ora: albero PGN navigabile mossa-per-mossa + "cambia mossa al ply X".)

### 6.8 SUGGERIMENTO di Nonno in partita (PlayStep) — a tempo + contestuale
Richiesta PO: nella fase PARTITA (gioco vs Maia@target), quando ci metto piu' di ~10-15s, Nonno mi da' un consiglio
FATTO BENE, "a seconda del momento". Un coach NON ti da' la mossa: ti dice dove guardare, e te la da' solo se sei bloccato.
- TRIGGER: nel TUO turno, timer; a ~12s senza muovere, Nonno offre un indizio (non invasivo). Sempre disponibile un
  "Chiedi a Nonno" manuale (per chiederlo prima). Reset ad ogni mossa.
- CALCOLO on-demand dalla posizione CORRENTE (niente precompute): chess.js (gia' usato) per leggere la situazione
  (pezzi avversari in presa catturabili / tuoi pezzi sotto attacco e indifesi / controlli o mosse forzanti) +
  useStockfish per la mossa migliore e se e' uno SWING tattico o una posizione tranquilla.
- INDIZIO A LIVELLI (escala solo se chiedi "un altro indizio"; "a seconda del momento" = il contenuto si ramifica):
  - Tier 1 (dolce, DOVE guardare): tattica concreta -> "Aspetta, qui c'e' qualcosa. Guarda le catture e i pezzi
    scoperti."; tuo pezzo in presa -> "Occhio prima di muovere: un tuo pezzo e' sotto tiro."; tranquilla -> "Niente di
    forzato. Non cercare il capolavoro: migliora il pezzo che sta peggio, o porta un pezzo verso il suo re."
  - Tier 2 (piu' stretto): indica la casa/colonna/pezzo (highlight della casa di partenza della mossa migliore), SENZA dare la mossa.
  - Tier 3 (la mossa): la mossa migliore (best_san). Se troppo difficile (p_maia_mine_top bassa) e c'e' una waiting_move,
    offri quella ("Se non la vedi, una solida e' {waiting}").
- Voce di Nonno, calda, non da' via il gioco. Highlight/arrow su BoardView per Tier 2/3. Niente dato finto: tutto Stockfish/chess.js-validato.
- Non blocca il gioco se il motore tarda (timeout/skip con grazia). Vive in frontend/src/session/PlayStep.tsx (+ eventuale util hint).

---

## 7. LA STORIA = registro del TRANSFER (ripensata, feedback PO 2026-05-30)

Problema (PO): la Storia attuale e' un DIARIO di cio' che il coach ha detto, non la prova di cosa TU
fai diverso nelle partite vere. Misura l'output dell'app, non il transfer. "Puo' essere potentissima o
una merda." Direzione scelta: registro del transfer + pattern-detection vero (affrontato N / schivato M).

### 7.1 La tesi
Una domanda, ogni giorno: **"Stai applicando quello che impari, partita vera dopo partita vera? E quanto
sei evoluto dal primo giorno?"** Tre strati: (1) polso di ieri, (2) applicazione nel tempo, (3) dal giorno 1.
Unisce gli attuali tab Evoluzione + Storia in UNA vista "Il tuo percorso" (via la ridondanza).

### 7.2 Pattern-occurrence detection (il dato nuovo, in analyze) — onesto
Oggi salviamo solo gli ERRORI. Per dire "affrontato N, schivato M" serve censire le OCCORRENZE del motif
anche quando NON sbagli. Modello (per OGNI posizione critica del giocatore, non solo gli errori):
- Classifica il MOTIF della decisione dal best-move Stockfish + geometria (chess.js, euristico):
  - `hanging_piece` (pezzo in presa): best move cattura un pezzo avversario indifeso / guadagna materiale,
    OPPURE un tuo pezzo e' attaccato e sotto-difeso e la best lo salva.
  - `fork`: la best crea un doppio attacco (2+ bersagli pezzo/re).
  - `back_rank`: best move e'/minaccia matto sull'ultima traversa o sfrutta debolezza dell'ultima traversa.
  - (`removed_defender`/`discovered`: approssimati o rimandati.)
  - else: `none` (decisione posizionale/tranquilla, niente motif tattico netto).
- Registra per posizione critica: `{ motif, handled: cp_loss < HANDLED_CP (es. 50), played_at, phase }`.
  Registra per TUTTE le critiche (gestite e non), non solo gli errori.
- Aggrega per motif su finestra/storia: `faced` = conteggio, `handled` = conteggio gestite, `rate = handled/faced`.
- ONESTA': la classificazione e' euristica (chess.js): "affrontato {motif}" e' approssimato, dichiaralo.
  Mai gonfiare "schivato". Sotto-soglia di numerosita' -> "dato insufficiente".

### 7.3 Aggregati transfer (aggregate.ts + history snapshot)
- Per motif/ancora: `faced` / `handled` / `rate`, finestrato (recent vs prior, per data partita) + nello snapshot
  history (serie nel tempo). Cosi' la "curva del transfer" e' reale.
- "Polso di ieri/recente": filtra le partite per `played_at` (ultime 24-72h o ultima sessione di gioco);
  per ogni freno: faced/handled in quella finestra vs baseline.
- "Dal giorno 1": primo snapshot (o partite piu' vecchie) vs oggi: rating, top freni, gap. Prima/dopo.

### 7.4 La vista "Il tuo percorso" (sostituisce Storia, assorbe Evoluzione)
- **Polso di ieri**: "Hai giocato N partite. Sul tuo freno X: affrontato A, schivato S (prima S0/A0). [verdetto]."
  Con le partite linkate (game_url). Voce di Nonno che legge il TRANSFER (non un diario che si ripete).
- **Applicazione nel tempo**: per ogni freno, curva faced/handled (o rate) dal giorno 1. "Lo schivavi 2 su 8, ora 6 su 8."
- **Dal primo giorno**: rating curve + profilo day-1 vs oggi (freni, gap). Il giocatore che stai diventando.
- Empty-state onesti finche' non ci sono >= 2 finestre di dati. Niente dato finto.
- Il diario di Nonno (coach_journal) resta come nota qualitativa, ma DEDUP (gia' fatto) e secondario.

### 7.5 Sequenza di build
1. analyze: pattern-occurrence detection (motif + handled per posizione critica). Richiede rianalisi per popolare.
2. aggregate + history: metriche transfer (faced/handled finestrato + snapshot).
3. UI "Il tuo percorso" (merge Evoluzione+Storia): polso di ieri + applicazione nel tempo + dal giorno 1.
Acceptance: build verde; numeri reali (mai finti); euristica dichiarata; empty-state onesti; nessuna ridondanza.
