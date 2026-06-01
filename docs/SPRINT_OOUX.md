# Sprint OOUX — Il Tavolo del Nonno diventa un'app pagabile

> Contratto d'esperienza di questo sprint. Ogni subagent legge QUESTO file prima di toccare codice.
> Fonte di verita' dell'IDENTITA': `.claude/skills/ooux/object-map.json` (validata da referee.py).
> Bussole: `docs/PRODUCT.md`, `docs/PRODUCT_VISION.md`, `docs/OOUX_IA.md`, `docs/DESIGN.md`, `frontend/src/types.ts`.

---

## 0. Il principio organizzatore (deciso dal PO il 2026-06-01)

> **Le analytics sono il PERCHE' di questo prodotto. Gli esercizi sono il COME.**

Non si pota il valore analitico: gli si da' EVIDENZA. La differenza tra noi e Aimchess NON e'
"grafici si' / grafici no". E':

| Aimchess / Insights | Il Tavolo del Nonno |
|---|---|
| Stat orfane che competono per l'attenzione | Le analitiche del TUO gioco, ordinate dalla spina |
| Una griglia muta che apri e chiudi | Un gioco letto da una persona, un'azione sola |
| "Ecco i tuoi numeri" | "Ecco PERCHE' sei fermo, ed ecco il COME uscirne" |

Il difetto del Tavolo vecchio non erano i grafici: era che erano un **muro piatto e muto**.
La cura non e' rimuoverli, e' dare loro **gerarchia + narrazione + spina + disciplina tonale**.

---

## 1. La spina (non negoziabile)

> **Un Momento, misurato dall'Avversario, esprime un'Ancora che ti separa dall'Obiettivo.**

Ogni superficie rende visibile un tratto di questa spina. L'analitica e' la spina resa numero;
l'esercizio e' la spina rigiocata.

---

## 2. Verita' a terra — cosa e' VIVO per-utente, cosa no (NON fingere il MISSING)

LIVE nel browser oggi (verificato in `frontend/src/pipeline/`):
- **Momento** (game_id+ply): `fen_before`, `cp_loss`, `best_uci` (NON best_san: converti con uciToSan),
  `played_uci`, `phase`, `spent_seconds` (a volte), `clock_remaining` (a volte), `last_opp_*` (a volte),
  `opening`/`eco`, `error_type`, `blame_weight`, `state_before`, `time_state`, `game_url`.
- **Avversario** (Maia gira ONNX nel browser, sulle ~400 posizioni peggiori per cp_loss):
  `p_mine_plays_best_sf`, `p_target_plays_best_sf`, `p_maia_mine_top`, `p_maia_target_top`,
  `move_difficulty`, `drill_value`, `priority_score`, `avoidable`. **Graceful**: se Maia non gira, restano null -> fallback Stockfish, MAI numeri Maia finti.
- **Ancora** (7 tipi: careless, hung_piece, rushed, conversion, zeitnot, missed_tactic, hard_calc):
  `category`, `count`, `share_of_errors`, `games_with`, `avg_cp_loss`, `rating_upside`, `weighted_score`,
  `exemplars` (top-3 Momenti), `trend_now` (finestra 28/28gg).
- **Obiettivo**: goal (target/deadline/current/on_track/projection), goalProgress.
- **Apertura/Repertorio** (eco+colore): games, win_rate, avg_acpl, errors, avoidable, recognized.
- **Partita**, **Lettura** (coach_brief.json via Edge Function), **SessioneSvolta** (journal localStorage),
  **DrillQueue** (effimera), **maia_weighted** (errors_scored/avoidable/mine_pct/target_pct/gap_pct),
  **history.json** (snapshot settimanali + serie per ancora), rating_curve, by_phase/by_color, decisions,
  tilt, time_management (spent_vs_accuracy), weekly_trend.

MISSING (marcato `source: MISSING` nell'object-map, NON inventare):
- **Struttura** (IQP/Carlsbad): zero dati. Niente schermata-Struttura per ora.
- `waiting_moves`, `prev_moves` (solo last_opp_*), fork/pin/back_rank (solo hanging_piece v1), best_san_sf.

---

## 3. La lista del NO (hard — il referee difende il concetto, non la stringa)

streak / giorni-di-fila, badge, leaderboard, percentile-vs-altri, accuracy-bar / eval-bar, confetti,
glow/neon, progress-bar di sessione, multi-coach, FOMO/gufo-triste, em-dash (usa virgola/due punti/parentesi),
"blunder" e "drill" come parole-utente (usa "errore grave", "esercizio"/"allenamento"), gradient-text,
card-dentro-card, border-left decorativi, transition: all.

---

## 4. Le 5 regole della craft anti-Aimchess (IL cuore dello sprint)

Ogni analitica esposta DEVE rispettare tutte e cinque, altrimenti diventa muro:

1. **Ordine per spina, non griglia.** I blocchi rispondono a domande in sequenza narrativa
   (Perche' sono fermo? -> Sto migliorando? -> Dove perdo?), non card affiancate che competono.
2. **Nonno narra ogni numero.** Ogni grafico ha UNA riga di Nonno che lo legge ("Qui perdi piu' che
   altrove, lo sistemiamo"). Niente numero orfano. La riga e' deterministica, derivata dai numeri,
   nella voce di [[nonno-voice]] (presentazione, non duplicazione del giudizio del modello).
3. **Disciplina tonale (DESIGN.md).** Miele SOLO per l'Obiettivo e rating_upside. Twilight <= 15% di
   superficie. FLAT (niente ombre decorative). Mono solo per numeri che Nonno cita. UNA sola CTA LOUD.
4. **Interprete a richiesta.** Un'analitica che non capisci e' cliccabile: porta al suo oggetto nel
   Quaderno dove Nonno la approfondisce. (CTA OOUX su una vista: kind=action o navigate.)
5. **Cross-link.** Ogni vista porta al suo oggetto. Da un'Ancora ai suoi Momenti (Cadute); da un
   Momento alla sua Apertura. La rete, non il menu.

---

## 5. TAVOLO — "il perche'", letto da Nonno (home `/`)

Superficie: la soglia che e' anche la lettura del tuo gioco. Oggetti: Lettura, Obiettivo, Momento,
Ancora, + le viste analitiche (Avversario/maia_weighted, trend, fase). Una sola CTA LOUD: **Sediamoci**
(il COME). Le analitiche (il PERCHE') hanno evidenza, ma narrate e ordinate dalla spina.

Ordine dei blocchi (il rituale di lettura):

1. **Nonno parla** (`NonnoGreeting`) — voce del giorno (coach_brief.open_tavolo) + **memoria visibile**:
   l'ultima `SessioneSvolta` dal journal ("L'altra volta ci siamo lasciati su d4"). CTA **Sediamoci** (LOUD).
2. **Obiettivo** (`GoalHero`, oro) — Da X a Y, on_track, riga progresso. La Regola del Miele.
3. **Il Momento del giorno** (NUOVO, la spina resa posizione) — il `Momento` che ti separa di piu' dal
   target. Selezione: massimo `drill_value` tra le cadute (priority_score=3) se Maia ha girato; altrimenti
   massimo cp_loss. Board mini (BoardView, arrows played rosso / best verde). Voce di Nonno con la tripletta
   dove vera: tempo ("8 secondi"), Avversario ("uno al tuo 1600 la trova 7 su 10, tu 1"), e la mossa
   giusta. Cliccando -> entra in Sessione su questo Momento (e' l'antipasto del COME).
   - Sorgente Avversario: `p_target_plays_best_sf` / `p_mine_plays_best_sf` -> "N su 10". Se null, NIENTE
     frase Maia: ripiega su tempo + cp + mossa giusta. Onesto.
4. **Il gap col target** (`maia_weighted`, SOLO testo) — il perche' reso UN numero, narrato:
   "Il {target} trova la mossa giusta il {target_pct}%, tu il {mine_pct}%. Quel {gap_pct} e' il tuo margine."
   Il grafico (GameArc) NON sta qui: vive nel Quaderno. Sul Tavolo resta la frase tagliente.
5. **Dove perdi, in breve** (`AnchorRow` top-3, compatte, cliccabili -> /quaderno#percorso) — le ancore
   SONO la sintesi narrata del "dove perdi". Niente grafici: solo le ancore + l'upside in oro.
6. **Il varco al Quaderno** — una card-soglia prominente ma QUIET (mai piu' LOUD di Sediamoci):
   "Apri il Quaderno" -> /quaderno, con una riga di Nonno ("la sala dove guardiamo tutto con calma").
7. **Azioni di servizio** (aggiorna partite / rianalizza) — ghost, sussurrate, in fondo. Invariate.

UNA SOLA SCHERMATA (decisione PO 2026-06-01): il fondo analitico NON si impila sul Tavolo (un nastro lungo
seppellisce, non espone). Le 2 analitiche piu' taglienti (Momento + gap) stanno sopra la piega; il resto si
RAGGIUNGE col varco. TOLTI dal Tavolo (gia' presenti o spostati nel Quaderno): RatingCurve, GameArc,
SpeedVsErrors, Decisions, Weekly, barre-per-fase, galleria cadute. NIENTE si cancella: cambia casa.

PRESERVA (non perdere lavoro): caricamento dati (player_model_lite + aggregates, deps [user, dataVersion]),
stati loading/error/empty, runRefresh/runFullReanalyze + nav("/onboarding/waiting"), navigazione /sessione.
Fai EMERGERE ogni `.error` di Supabase sulle scritture.

---

## 6. SESSIONE — "il come" (rotta `/sessione`)

Il loop attivo a 4 fasi su `Momento` + `Avversario`: guardo (passivo, Nonno commenta) -> Nonno mi aiuta
(hint: casa di partenza in oro) -> da solo (drill) -> partita vs `Avversario`@target -> saluto.

- **Tripletta di voce fissa in `MomentReview`**: tempo speso, confronto Maia ("1 su 8 al tuo livello"),
  **un errore alla volta** (mai la lista). Voce di [[nonno-voice]].
- **Chiusura**: scrive una `SessioneSvolta` (journal) + una voce nel Quaderno (la memoria di domani).
  Niente recap con grafici/streak/confetti.
- Robustezza 0/1/2/3+ cadute gia' gestita: preservala.

---

## 7. QUADERNO — "il fondo" / la sala d'analisi (rotta `/quaderno`)

PRIMA CLASSE (decisione PO 2026-06-01): non e' backstage, e' la SALA D'ANALISI dove vai apposta a capire.
Riceve TUTTO il fondo tolto dal Tavolo. Gia' presenti (verificato via grep): RatingCurve (STORIA),
Decisions/Speed/Weekly/by_phase (PROFILO), cadute, repertorio, percorso/trend. DA AGGIUNGERE: `GameArcChart`
(l'unico orfano, oggi solo sul Tavolo) vicino al contenuto maia/gap. La marea COMPLETA come rete di OGGETTI
cross-linkati, non menu di pagine. 6 tab attuali (percorso, diario, traguardi, profilo, cadute, repertorio).

- Da un'**Ancora** (percorso) -> i suoi **Momenti** (cadute, filtrate). Da un **Momento** -> la sua **Apertura**.
- Nonno e' l'interprete a richiesta. Si arriva dal varco del Tavolo.

---

## 8. Il momento pagabile (paywall value-trigger)

Alla 3a sessione, in voce di Nonno, **loss-framed** (cosa smette di esistere se te ne vai: la memoria,
le lettere del lunedi', il ritorno), NON "prova scaduta". Anchor: 9.90 euro/mese vs 79 euro/anno.
Cancellazione in 1 tap, confermata da Nonno. Free: 7 giorni full + 100 partite ([[freemium_tiering_model]]).

---

## 9. Brand finish

Nome canonico: **Il Tavolo del Nonno** (ex-Mygotham). Icona (nonno + lampada, navy/miele) -> favicon + PWA
+ titolo. Palette DESIGN.md gia' allineata (notte profonda, miele d'onice = lampada, twilight = crepuscolo).

---

## 10. Ritmo di lavoro

Opus dirige (spec/verifica), Sonnet esegue. `nonno-eng` implementa, `tavolo-design` cura la craft anti-Aimchess,
`nonno-copy` scrive la voce, `nonno-review` rilegge il diff PRIMA di ogni commit. Build VERDE
(`cd frontend && npm run build`) prima di ogni commit. Commit/push SOLO quando lnesi lo chiede. Branch corrente:
`feat/experience-v2`. Mai committare `.claude/` o `CLAUDE.md`.
