# OOUX & Information Architecture — Nonno's Table

> v1 · 2026-05-29 · Bozza da PO-review.
> Scopo: progettare l'architettura del prodotto **partendo dagli oggetti** del dominio
> e dalle loro relazioni (OOUX), per **esporre la marea di valore** senza il
> trappolone minimalista "tutto dietro un'icona" e senza soluzioni-pulsante.
> Si basa sul censimento reale del codice (12 pagine, ~35 componenti, i tipi dati).

---

## 0. La tensione di partenza (il fatto che decide tutto)

Esistono **due modelli dati** nel codice:

- **Vecchio — `PlayerModel`** (prodotto dal backend Python, single-user): RICCO.
  Maia (mine vs target), motif tattici, strutture pedonali, repertorio per ECO,
  rating curve storica, tilt, time-management, `growth_delta` con serie settimanale,
  diagnosi. → È la **marea di valore** che alimentava Cruscotto/Patterns/Storia/Repertorio.
- **Nuovo — `Aggregates`** (prodotto dal browser, per-utente, zero-worker): MAGRO.
  Solo Stockfish: blunder/mistake/inaccuracy %, cp_loss, by_phase/by_color/by_time_class,
  + le 8 mosse-esempio peggiori. **Niente Maia, niente motif, niente strutture, niente storia.**

> **Conseguenza:** le viste ricche **non sono morte, sono affamate.** I componenti
> esistono e sono in gran parte già disaccoppiati (accettano "slice" di dati, non il
> monolite). Quello che manca non è la UI: è il **calcolo dei dati per-utente browser-side.**
> Questa è la vera roadmap.

---

## 1. Gli OGGETTI (i sostantivi del dominio)

L'utente pensa per oggetti, non per schermate. Questi sono i 9 oggetti utente-facing
(deduplicati dagli stati implementativi tipo IngestJob/SrsCard/SessionState):

| Oggetto | Cos'è | Attributi-chiave |
|---|---|---|
| **Partita** | una partita reale da Chess.com | data, colore, risultato, rating avversario, apertura/ECO, time_class |
| **Momento** | una posizione critica (l'ATOMO) | FEN, mossa giocata vs migliore, cp_loss, fase, motif, **drill_value**, spent_seconds, prev_moves |
| **Freno** (Pattern) | una debolezza ricorrente verso il target | categoria, frequenza %, **trend settimanale**, impact_score, stato SRS, occorrenze |
| **Struttura** | contesto strategico (IQP, Carlsbad…) | label, win_rate, motif dominante, aperture da cui nasce, posizioni-campione |
| **Apertura** | una linea del repertorio | ECO, win_rate, ACPL, posizioni-chiave deboli |
| **Obiettivo** | dove vuoi arrivare | target, orizzonte, proiezione, on_track, ritmo richiesto vs reale |
| **Avversario** (Maia@target) | il benchmark calibrato | livello mine vs target, p(trova la mossa giusta) |
| **Sessione** | l'atto di allenamento (~15 min) | momenti rivisti, bivio rigiocato, punti, streak |
| **Quaderno** | la memoria continua | voci datate (drill fatti, freni domati, progressi) |

### La mappa delle relazioni (il cuore OOUX)

```
                         OBIETTIVO ───contestualizza tutto───┐
                            │                                │
        PARTITA ──ha molti──► MOMENTO ◄──istanza di── FRENO  │
           │                   │  │  └──raggruppati in──┘     │
           │                   │  └──dentro──► STRUTTURA      │
           └──in──► APERTURA ◄─┘             (nasce da Apertura)
                                   │
            MOMENTO × OBIETTIVO ───┴──► drill_value  (via AVVERSARIO/Maia)
                                            │
                       SESSIONE ──rivede/rigioca──► MOMENTO
                          │
                          └──scrive──► QUADERNO (voci) ──dà continuità──► tutto
```

### La relazione-spina (il differenziatore, da memoria prodotto)

> **Momento × Obiettivo = `drill_value`** = `p(target trova la mossa) − p(tu la trovi)`.
> Tradotto: *"questa la trova chi vuoi diventare, tu ancora no"*. È il **freno relativo al
> target** reso numero su una posizione concreta. Tutto il prodotto ruota qui — non attorno
> a "gioca una partita", ma attorno a **quanto un Momento ti separa dal tuo Obiettivo.**

---

## 2. Cosa puoi FARE con ogni oggetto (le azioni → niente menu astratto)

- **Momento** → *Vedi* (board + costo + mossa giusta + variante) · *Riprova* (puzzle inline) · *Rigioca il bivio* (vs Avversario calibrato) · *Apri su Chess.com*
- **Freno** → *Esplora* (trend nel tempo + tutte le occorrenze) · *Allena* (coda drill sulle tue posizioni) · *Confronta* (migliorando/peggiorando)
- **Struttura** → *Esplora* (da quali aperture nasce, dove sbagli dentro) · *Allena le posizioni*
- **Apertura** → *Vedi le 3 posizioni dove cadi* · *Rigiocale vs Avversario*
- **Obiettivo** → *Modifica* · *Vedi proiezione* (ce la fai per la deadline?)
- **Sessione** → *Sediamoci* (start) · *Riprendi* · *Recap*
- **Quaderno** → *Sfoglia* (Evoluzione → Storia → Cadute → Repertorio → Dati)

---

## 3. L'IA che ne DISCENDE: 3 superfici, navigazione a oggetti

Non una dashboard-menu (overload) e non un'unica schermata (minimalismo). **Tre superfici**,
e dentro ognuna gli oggetti sono **liste → dettagli cross-linkati** dalle relazioni.

### A. TAVOLO — "oggi, cosa conta" (entry, NON vuoto)
La voce di Nonno (brief) · i **top Freni** del giorno (cliccabili) · l'anello **Obiettivo**
(quanto manca) · la **mossa che ti è costata di più** (un Momento reale) · CTA **Sediamoci** (LOUD).
→ È un cruscotto-di-priorità, non un muro vuoto. Da qui si tuffa in ogni oggetto.

### B. SESSIONE — "allena" (il loop attivo)
Rivedi N Momenti (drill, tema nascosto fino al tentativo) → rigioca **un bivio vs Avversario@target**
(con **SureCheck** anti-blunder) → recap → voce nel Quaderno. ~15 min, sulle TUE posizioni.

### C. QUADERNO — "esplora" (la marea, navigabile)
La casa continua, **prima classe** (non nascosta). I tuoi oggetti come sezioni cross-linkate:
- **Evoluzione** — Freni con trend + proiezione Obiettivo *(default: la prima domanda è "sto migliorando?")*
- **Cadute** — galleria dei Momenti (filtrabili per Freno/fase/colore) → dettaglio Momento
- **Profilo** — i tagli analitici del **Cruscotto**: tempo (clock vs mossa), decisioni (converti/butti/salvi), tilt
- **Storia** — rating curve (perf vs Elo) + trend + diario narrativo
- **Repertorio & Strutture** — Aperture deboli e Strutture, con rigioco vs Avversario

> **Il cross-linking è la vittoria OOUX**: da un Freno arrivi ai suoi Momenti; da un Momento
> alla sua Struttura e alla sua Apertura; da una Struttura alle Aperture che la generano.
> È una rete di oggetti collegati, non un menu di pagine scollegate.

---

## 4. Matrice disponibilità dati = la roadmap reale

| Oggetto / valore | Ora (browser `Aggregates`) | Serve portare per-utente |
|---|---|---|
| Partita, Momento (base) | ✅ cp_loss, mossa giusta, fase | — |
| Mossa-esempio peggiore | ✅ (già in Home) | — |
| **Freno con trend storico** | ⚠️ solo % per fase, niente serie | **serie settimanale** (snapshot ripetuti nel tempo) |
| **drill_value / Avversario** | ❌ | **Maia browser-side** (o approssimazione) — *il differenziatore* |
| **Motif tattici** (fork, back-rank…) | ❌ | **detection** sui Momenti |
| **Strutture pedonali** | ❌ | classificatore strutture |
| **Repertorio per ECO** | ⚠️ aggregato per time_class | parsing apertura/ECO |
| Rating curve / tilt / time-mgmt | ❌ | bucket da PGN (clock tags) + storia |

> **La buona notizia (dal censimento):** quasi tutti i componenti (`PatternCard`,
> `RatingCurveChart`, `SpeedVsErrorsChart`, `StructuresPanel`, `BoardView`…) accettano già
> *slice* di dati o oggetti OOUX → **si riaccendono con pochissimo lavoro UI** appena il dato esiste.
> Il lavoro è il **data layer**, non le viste.

---

## 5. Roadmap proposta: "accendi un oggetto alla volta"

1. **Freno reale + galleria Momenti** *(dato già quasi pronto)* — porta `examples`/per-mossa
   nei Freni e nella tab Cadute. Riusa `PatternCard`, `BoardView`, `PositionDetail`.
2. **Avversario/drill_value** *(il differenziatore)* — Maia (o proxy) browser-side → riaccende
   `drill_value`, il "il target la trova, tu no". È ciò che batte Chess.com.
3. **Motif tattici** → Freni veri (fork, pin, back-rank…), non solo "fase".
4. **Storia** — snapshot ripetuti (il loop di ritorno P2 già li genererà) → trend + rating curve.
5. **Strutture / Repertorio ECO** → le ultime due viste.

Ogni passo = un oggetto che si illumina nel Quaderno. Il Tavolo e la Sessione restano stabili.

---

## 6. Decisione aperta per il PO
- Confermi le **3 superfici** (Tavolo / Sessione / Quaderno-navigabile)?
- Da quale oggetto accendiamo per primo: **(1) Freni+Cadute** (veloce, dato pronto) o
  **(2) Avversario/drill_value** (il differenziatore, ma richiede Maia browser-side)?
