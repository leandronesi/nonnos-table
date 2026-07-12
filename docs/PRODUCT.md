# Nonno's Table — Product Manifesto

**Versione 1.0 — 2026-05-25**
Documento canonico. Quando una decisione di prodotto è incerta, si torna qui.

---

## 0. Aggiornamento 2026-05-29 — evoluzione del modello

Due decisioni del PO che EVOLVONO questo manifesto. Dove confliggono con §5, §6 e la regola §11.4, prevale quanto segue.

### 0.1 "Ancore", non "freni"

Il cuore non è una lista di debolezze (colpa), ma le tue **ancore**: ciò che ti tiene fermo al tuo livello. Il framing guarda in avanti: ogni ancora indica una priorità allenabile, non un guadagno Elo promesso. L'unità resta quella della Vision (pattern, posizioni, comportamenti, pesati per i segnali Maia e relativi al target), ma nome ed espressione sono motivazionali: cosa vale la pena allenare adesso e come verificarne il cambiamento.

### 0.2 Dati esposti, Nonno è l'interprete (non il narratore)

Si abbandona il "Nonno + 1 bottone, tutti i dati dietro 📓" (§5-6, regola §11.4). Il **dato e i grafici sono il protagonista** (esponi il valore). **Nonno è un di cui**: il layer che ti aiuta a LEGGERE i dati su richiesta. Clicchi un grafico che non capisci, lui ti dice cosa vuol dire e cosa farci. On-demand, non un monologo che fa da cancello.

### 0.3 Flusso della Sessione: guardo → Nonno aiuta → gioco da solo → partita

La Sessione e' una progressione pedagogica (io guardo, facciamo insieme, faccio da solo, gioco), NON solo review passivo. I drill attivi TORNANO. Quattro fasi:
1. **Guardo + Nonno parla**: rivedo la posizione, Nonno la commenta (tempo, confronto Maia relativo tra livello attuale e target, mossa d'attesa). Passivo.
2. **Nonno mi aiuta**: trovo la mossa con l'aiuto di Nonno (hint visivo, casa di partenza). Guidato.
3. **Gioco da solo**: trovo la mossa senza aiuto. Drill.
4. **Partita**: gioco dalla posizione di una mia partita; la UI dichiara se la
   mossa avversaria arriva dalla policy Maia o dal fallback Stockfish, senza
   presentare il conditioning sul target come equivalenza di rating umano.

### 0.4 Note di prodotto

Il resto del manifesto (lessico §17, le 3 firme §10, il loop temporale §13) resta valido. Cambiano il PESO di Nonno (da protagonista a interprete CHE PERO' ti accoglie con un racconto all'ingresso, §6) e il NOME del cuore (ancore).

---

## 0.5 Aggiornamento 2026-06-22 — non più «mostra», ma «spiega»

Feedback del tester Daniele (principiante vero): «bello il tavolo del nonno,
ma mi piacerebbe spiegasse perché. Non sono così bravo da capirlo al volo.»
Il prodotto era tarato su un giocatore esperto. Questa è la correzione di rotta:
**dove confligge con §7, §10, §11.3 e §0.2, prevale quanto segue.**

### Il principio

Ogni verdetto porta con sé il **perché vero**. Non basta mostrare la mossa
giusta: Nonno dice *cosa* fa quella mossa e *cosa* lasciava la tua.
«La mossa giusta era Tf1» diventa «Il tuo cavallo in e5 era in presa: dopo
Txd5 te lo prendeva gratis. Tf1 lo mette al sicuro.»

### Il meccanismo: «frase vera dalla posizione»

Il perché è **board-aware deterministico**: chess.js legge la posizione e ne
estrae i fatti reali (quale pezzo era in presa, su quale casa, cosa minaccia la
mossa giusta), e Nonno li racconta con la sua voce. **Zero LLM, offline,
istantaneo, sempre coerente.** Regola dura: **mai inventare**. Si emettono solo
fatti veri della scacchiera; quando il fatto non è certo, Nonno tace e resta il
verdetto nudo (meglio il silenzio di una spiegazione sbagliata).

Scartati dal PO: i *template generici* per motivo («il pezzo era in presa»,
uguale per tutti) come troppo superficiali; l'*LLM-per-mossa* (racconto generato
su ogni posizione) rinviato come possibile **approfondimento futuro su
richiesta** (un «entriamo nel dettaglio?» che chiama la voce), non come base.

### Due pattern di spiegazione, separati per superficie

- **Sessione (verdetti delle mosse):** la frase-perché è **sempre visibile**
  sotto il verdetto. Non è un bottone. Questo **supera** il «Niente Spiegami di
  più» del §7: il perché non è un extra opzionale, è parte del verdetto. Resta
  una sola CTA «Avanti» (nessun nuovo bottone nel flusso).
- **Grafici e dati (Tavolo, Quaderno):** **tocca-per-spiegare** (il «?» di
  `NonnoExplain`), on-demand, come già previsto da §0.2. Clicchi un grafico che
  non capisci, Nonno ti dice cosa vuol dire e cosa farci. Il gergo tecnico
  (ACPL, performance rolling) va tradotto in lingua naturale.

### Ancore: mostra l'azione, non solo l'etichetta

Ogni Ancora porta con sé la sua **frase-azione** (cosa fare di concreto, già
scritta in `i18n/anchors.ts`), sempre visibile accanto all'etichetta e al
segnale di priorità. «Pezzi in presa · 22% degli errori osservati» porta a:
«Controlla sempre le catture dell'avversario prima di muovere.»

### La voce

Le frasi-perché sono **voce di Nonno autoriale** (frammenti scritti, non LLM):
valgono come voce a tutti gli effetti se rispettano la skill `nonno-voice`
(frasi corte, lessico scacchistico italiano, niente em-dash, 2a persona, mai
paternalismo). Bilingui IT/EN.

## 0.6 Aggiornamento 2026-07-11 — semantica Maia e promesse misurabili

Gli output della policy Maia sono **indici relativi sullo stesso FEN**, non
frequenze calibrate sui giocatori Chess.com. È quindi vietato tradurre `0.20`
in «2 giocatori su 10», «20% dei giocatori» o formule equivalenti.

- Stockfish verifica la posizione e l'insieme osservato di mosse accettabili.
- Maia confronta quanto quelle scelte sono compatibili con il livello attuale e
  quello obiettivo: «più naturale al target», «nessun divario netto», oppure un
  indice/lift esplicitamente relativo.
- `avoidable_at_current` significa soltanto che la policy corrente supera una
  soglia euristica di supporto sull'insieme accettabile osservato; non autorizza
  da solo il copy «potevi trovarla». `target_relevant` significa allenabile nel
  percorso verso l'obiettivo, non inevitabile o facile per una persona.
- Nessuna ancora promette `+N Elo`: si mostrano ricorrenza, quota degli errori
  osservati e priorità relativa. Il miglioramento va provato sulle opportunità
  future nelle partite reali.

## 0.7 Aggiornamento 2026-07-11 — free beta e metrica operativa

Questo aggiornamento supera la riga pricing del §3, la metrica del §14 e il
pricing del §16 dove confliggono.

- La beta è gratuita. Non viene promesso né progettato ora un piano Pro o un
  prezzo: la priorità è dimostrare utilità, fiducia e uso ricorrente.
- L'obiettivo di scala è 10-15K **recurring learners**, non account creati:
  almeno due giorni distinti con `session_completed` negli ultimi 28 giorni e
  almeno un giorno negli ultimi 7. La definizione e le query canoniche sono in
  [PRODUCT_METRICS.md](PRODUCT_METRICS.md).
- Le prove principali sono activation, D7/W4 retention e transfer su
  opportunità successive a un intervento, sempre con denominatore e soglie di
  evidenza. «Cita Nonno» resta una qualità desiderabile del brand, non la metrica
  operativa unica.
- Un'eventuale acquisizione da parte di Chess.com è un esito strategico sperato,
  non una promessa all'utente né un motivo per indebolire privacy o verità dei
  claim.

---

## 1. Cosa è il prodotto, in una frase

> Un **tavolo quotidiano** con un nonno scacchista che ti conosce attraverso
> le tue partite reali, **rivede** con te i tuoi momenti chiave, ti ferma
> prima dei tuoi errori, ricorda quello che ti ha detto, e ti misura
> nel tempo.

Non è un trainer. Non è una dashboard. Non è un puzzle solver. È un
**rapporto di 15 minuti al giorno** basato sulle tue partite vere.

## 2. La verità che lo regge

Tu non vai al Tavolo **per giocare**. Vai per **rivedere**. Per **capire**.
Per **migliorare**.

Giocare è la fine della sessione, non il centro. L'80% del valore sta nel
review insieme a Nonno: vedere come sei arrivato a un errore, capire
quanto tempo hai speso sulla mossa, confrontare gli indici relativi Maia fra
livello attuale e obiettivo, e vedere quando Stockfish valida una **mossa di
attesa** robusta senza dichiarare che la linea esatta fosse impossibile per te.

## 3. Categoria competitiva e moat

| | Categoria sbagliata (saturata) | Categoria giusta (vuota) |
|---|---|---|
| Esempi | Aimchess, Chess.com Insights, Lichess Insights | Replika, Calm, Headspace, MasterClass |
| Valore | "Ti analizzo le partite" | "Sono qualcuno per te" |
| Loop | Apri, vedi grafici, esci | Apri, ti siedi, ti parlo, torni domani |
| Moat | feature tecniche (copiabili) | personaggio + memoria (non copiabili) |
| Pricing tollerato | $5-10/anno | €9.90/mese sostenibile |

Mygotham vince se l'utente **cita Nonno fuori dall'app**, come si cita
una persona. Non se l'utente vede +30 di rating.

## 4. Le 3 modalità del rapporto

Tutto il prodotto deve essere riconducibile a una di queste 3 modalità.
Niente sta fuori da qui.

| # | Modalità | Chi inizia | Dove succede |
|---|---|---|---|
| **A** | **Lui ti scrive** | Nonno (outbound) | Push notification + email del lunedì + frase del Tavolo all'apertura app |
| **B** | **Tu vai da lui** | Tu (inbound quotidiano) | Sessione 15 min |
| **C** | **Tu apri il Quaderno** | Tu (a piacere) | Archivio: dati, cadute, storia, repertorio |

## 5. La struttura: 2 schermi + 1 sub-schermo

Il prodotto **NON è una multi-page app** con `/cruscotto`, `/storia`,
`/repertorio`, `/profilo`. Quelle 4 rotte oggi sono cubi che disorientano.

È **2 schermi visibili** più un quaderno nascosto:

| Schermo | Cos'è | CTA unica |
|---|---|---|
| **TAVOLO** (home `/`) | Nonno ti parla. 3-4 frasi. Niente card affiancate, niente label uppercase, niente backstage in vista. Solo Nonno + un bottone. | "Sediamoci" |
| **SESSIONE** (rotta unica) | Il flusso giornaliero: 3 momenti di review + 1 partita finale + saluto. Un unico flusso, non 4 step staccati. | (chiude a fine, torna al Tavolo) |
| 📓 **Quaderno** (sub, da icona piccola in alto) | UN posto solo per: dati, cadute, storia, repertorio, dati MAIA, growth_delta, tutte le statistiche. È backstage. Solo se vuoi. | (esce, torna al Tavolo) |

## 6. Scena: Tavolo

```
┌──────────────────────────────────────────────┐
│ Nonno O.                              📓     │
│                                              │
│   Oooh, eccolo. Oggi rivediamo tre momenti   │
│   delle tue ultime partite. Uno con tempo    │
│   speso, due in cui hai forzato dove non si  │
│   poteva. Poi proviamo contro Stockfish.      │
│                                              │
│         ┌──────────────────────┐             │
│         │  Sediamoci       →   │             │
│         └──────────────────────┘             │
│                                              │
│   3 momenti · 1 partita · 15 minuti          │
└──────────────────────────────────────────────┘
```

Note:
- L'apertura di Nonno **anticipa il contenuto** della review di oggi.
  Cita le posizioni vere selezionate dal backend, non template generici.
- Una sola CTA. Mai 2 bottoni affiancati.
- Il "📓" è discreto, in alto a destra. Niente menu di navigazione.

## 7. Scena: Sessione — il REVIEW

Ogni momento di review mostra:

```
┌────────────────────────────────────────────────┐
│ ← Tavolo                              1 di 3   │
│                                                │
│ "Lunedì 19 maggio, vs un 1180. Mossa 24.       │
│  Avevi 1:48 sull'orologio."                    │
│                                                │
│     ┌────────────────────────────┐             │
│     │  [ scacchiera 460px ]      │             │
│     │  con highlight ultima      │             │
│     │  mossa avversaria          │             │
│     └────────────────────────────┘             │
│                                                │
│  21. Cf3   Cc6   22. d4   exd4   23. Cxd4  ●  │
│  (mosse precedenti — slider navigabile)        │
│                                                │
│  ───────────                                   │
│                                                │
│  Hai mosso Cxd5 in 8 secondi.                  │
│  La mossa giusta era Tf1.                      │
│                                                │
│  Maia associa questa scelta più al livello     │
│  1500 che al tuo livello attuale.              │
│                                                │
│  Lì era meglio una mossa di attesa — Re1, h3.  │
│  Aspettare, non forzare quando non vedi.       │
│                                                │
│         ┌──────────────────────┐               │
│         │  Avanti  →           │               │
│         └──────────────────────┘               │
└────────────────────────────────────────────────┘
```

Note tecniche:
- Le 3-4 mosse PRECEDENTI sono navigabili (slider/arrows sotto la
  scacchiera). L'utente vede il film, non la fotografia.
- Tempo, indici relativi MAIA mine vs target, alternative "di attesa" sono
  parte del **discorso di Nonno**, non statistiche affiancate.
- Una sola CTA: "Avanti". Niente "Salta", niente "Tutorial", niente
  "Spiegami di più". **[Superato da §0.5]** Il perché della mossa è ora
  SEMPRE VISIBILE sotto il verdetto (riga-perché board-aware), non un bottone:
  resta vero che non c'è un secondo CTA nel flusso.

## 8. Scena: Sessione — la PARTITA finale

Dopo i 3 review, la partita pratica:

- Vs MAIA al **rating target** (es. MAIA 1500 se target = 1600, MAIA 1400
  se l'utente è ancora a 1100 — soglia adattiva).
- Posizione iniziale: da uno dei turning point delle tue partite reali
  (riprendi una situazione che hai vissuto).
- Durante: bottone "Ripensaci" sempre disponibile (undo dell'ultima mia
  mossa fino a quando l'engine non risponde).
- Quando blundereo: Nonno appare, mi ferma, mi fa rigiocare.
- Posso interrompere e andare al recap quando voglio.

## 9. Scena: Sessione — chiusura

```
┌──────────────────────────────────────────────┐
│   Bravo. Oggi hai fermato la mano due volte. │
│   Domani lavoriamo sul contromossa.          │
│                                              │
│         ┌──────────────────────┐             │
│         │  Vai e respira       │             │
│         └──────────────────────┘             │
└──────────────────────────────────────────────┘
```

Niente recap con grafici/streak/stat. La memoria sta dentro il quaderno
(che Nonno aggiorna da solo, non l'utente).

## 10. Le 3 cose-firma della voce di Nonno (nuove)

Queste tre cose distinguono il prodotto da QUALSIASI altro. Devono entrare
nei prompt LLM, nei template frontend, nelle frasi pre-generate.

### A. Il tempo speso sulla mossa

> *"Hai mosso Cxd5 in 8 secondi."*
> *"Hai pensato 41 secondi e hai comunque mosso quella."*

Già nel db come `spent_seconds`/`time_spent_on_move`. Mai usato finora.

### B. Il confronto MAIA mine vs target

> *"Maia associa questa scelta più al livello 1500 che al tuo livello attuale.
> È un confronto relativo, non una frequenza."*

Le masse di policy mine/target sono segnali comparativi sulla stessa posizione.
Non vanno esposte come probabilità umane calibrate; il prodotto mostra il verso
del gap o un indice relativo con una spiegazione esplicita.

### C. Il consiglio della "mossa di attesa"

Quando l'insieme osservato delle mosse accettabili riceve **massa di policy
bassa al livello attuale** (segnale euristico, non probabilità umana) E la
posizione **non è forzante** (non c'è una tattica obbligata), Nonno può
insegnare una strategia pratica:

> *"Lì era meglio una mossa di attesa — Re1, h3. Aspettare, non forzare
> quando non vedi."*

Le candidate "di attesa" si ricavano da Stockfish multi-PV (mosse con
cp_loss < 50 che non forzano scambi/catture/scacchi). Backend deve esporre
una lista `waiting_moves` per le posizioni dove ha senso.

## 11. Le 5 regole della sottrazione

1. **Review prima, gioco dopo.** L'80% del tempo è capire, il 20% è
   giocare. Il CTA è *"Sediamoci"*, non *"Vieni a giocare"*.
2. **1 sola voce in tutto il prodotto.** Sempre Nonno, 2a persona TU.
   Mai "Il giocatore ha fatto X" / "Stato attuale" / "Profilo".
3. **1 sola CTA per schermo.** Mai 2-3 bottoni affiancati. Mai "Salta",
   "Tutorial", "Aiuto" visibili.
4. **[SUPERATO da §0.2 il 2026-05-29]** La regola originale diceva "tutti
   i dati dietro UNA icona 📓". Ora vale l'opposto: **i dati e i grafici
   sono esposti** (esponi il valore) e **Nonno è l'interprete a richiesta**
   che te li spiega quando ci clicchi. Resta vero che la voce di Nonno cita
   numeri concreti osservati (tempo, partite coinvolte, quota degli errori) e
   descrive Maia soltanto come confronto relativo tra livello attuale e target.
5. **Lui ti convoca, tu non cerchi.** Niente menu di scelta tipo
   "Pattern / Profilo / Trainer". Il prodotto ti porta dove ti deve
   portare.

## 12. Cosa NON è il prodotto

| ❌ Non è | ✓ Perché |
|---|---|
| Un puzzle trainer | Aimchess e Lichess training esistono, gratis o quasi |
| Un opening explorer | Chess.com Opening Explorer, Lichess Explorer, gratis |
| Un PGN analyzer | Esistono 100 tool gratis |
| Una dashboard di statistiche | Insights di Chess.com fa già questo, e meglio |
| Un'app con leaderboard, achievement, badge, livelli | Distrae dal rapporto, è gamification finta |
| Un'app con multi-coach (scegli il tuo) | È UN coach. Nonno O. Personaggio definito. Non sostituibile. |

## 13. Il loop temporale

| Quando | Iniziatore | Cosa |
|---|---|---|
| **Lunedì 9:00** (settimanale) | Nonno (email) | *"Settimana scorsa è andata X. Oggi lavoriamo su Y."* |
| **Dopo partita Chess.com** (event) | Nonno (push) | *"Ho letto la partita di ieri sera. La vediamo insieme stasera?"* |
| **Apertura app** (quotidiana) | Nonno (Tavolo) | 3-4 frasi che cambiano in base a brief + journal + growth_delta + storico recente |
| **Sessione** (15 min, quotidiana) | Tu | 3 review + 1 partita vs MAIA target + saluto |
| **Quaderno** (a piacere) | Tu | Vedi i dati. Sono lì. Sono backstage. |

## 14. La metrica unica di successo

> **"L'utente è tornato ieri E ha citato Nonno parlandone con qualcuno."**

Non DAU, non sessions/day, non blunder reduction. Il prodotto vince se
viene **nominato come una persona** fuori dall'app.

## 15. Dati che il backend deve esporre (architettura informativa)

### Per ogni momento di review nella sessione

Già disponibili nel `pm.drills[i]` / `pm.turning_points[i]`:
- `fen_before`, `san`, `best_san_sf`
- `motif_*` (hanging_piece, fork, ecc.)
- `my_color`, `date`, `opp_rating`
- `p_maia_mine_top`, `p_maia_target_top`, `move_difficulty`
- `last_opp_san`, `last_opp_from`, `last_opp_to`
- `cp_loss`

Da aggiungere o esporre meglio:
- **`spent_seconds`** sulla mossa (esiste nel db, non in PositionRow attuale)
- **3-4 mosse PRECEDENTI** (PGN snippet o lista SAN) per il contesto
- **`waiting_moves`**: 2-3 alternative "di attesa" Stockfish-validate quando
  la posizione lo permette e p_maia_mine_top è basso

### Per il Quaderno (sub-schermo)

Tutti i dati attuali di `pm.*` accessibili da tab:
- Dati (KPI generali)
- Cadute (drill ordinati per cp_loss + commento Nonno)
- Storia (story / progress / roadmap / growth_delta)
- Repertorio (openings + win_rate per colore)

## 16. Pricing implicito

- **Free**: provi 1 settimana, il rapporto si stabilisce
- **Pro €9.90/mese**: il Nonno completo (memoria persistente, email
  lunedì, push event-driven, MAIA sparring, mosse d'attesa, growth_delta
  raccontato)
- **NON**: Free vincolato a 1 sessione/giorno con paywall. Free
  full-experience per 7 giorni → poi conversione o churn.

## 17. Lingua

Italiano vero, scacchistico tradizionale. **Mai calchi dall'inglese**.

| ❌ | ✓ |
|---|---|
| pezzo appeso | pezzo in presa |
| hanging piece | pezzo in presa |
| blunder | errore grave (in voce: "ci hai regalato il pezzo") |
| target | (riformulato caso per caso) |
| drill | esercizio (in voce: "posizione", "momento") |
| streak | giorni di fila |

Quando il prodotto sarà internazionalizzato, ogni lingua avrà la SUA
forma di Nonno (Grandpa, Opa, Abuelo, Dziadek). Stesso archetipo,
stesso ritmo (frasi corte, "Oooh", cita posizioni concrete), lessico
scacchistico locale.

## 18. Cosa cambia da oggi (transizione operativa)

Per portare il prodotto dallo stato attuale (Bento home con 5 card,
session a 4 step staccati) a questo schema:

| Ambito | Cambio | Effort |
|---|---|---|
| **Home** | Rimuovi CoachPanel, MistakesTeaser, LastGamePanel, NavigationPanel come pannelli sul Tavolo. Il Tavolo è solo Nonno + 1 bottone. | 1 giorno |
| **Rotte** | Rimuovi `/cruscotto`, `/storia`, `/repertorio` dal nav. Diventano tab del Quaderno (icona 📓). | 0.5 giorno |
| **Sessione** | Trasforma 4-step in 1-flusso unificato. Warmup/Bivio diventano "review" (3 momenti, ognuno con contesto + dati). Play resta come "partita pratica vs MAIA target". | 2 giorni |
| **Backend `_verified_facts`** | Già arricchito (5 insight adattivi). Mantenere. | — |
| **Backend `waiting_moves`** | Nuovo: per ogni posizione di review, estrai 2-3 alternative di attesa Stockfish-validate. | 1 giorno |
| **Backend `spent_seconds` esposto in PositionRow** | Già nel db, da aggiungere all'export pm. | 0.5 giorno |
| **Backend "PGN snippet 4 mosse prima"** | Per ogni drill/turning_point, esponi le 4 mosse precedenti come array. | 0.5 giorno |
| **Frontend review UI** | Nuovo componente `MomentReview.tsx` che mostra contesto + scacchiera + slider + frase Nonno con dati. | 2 giorni |
| **Frontend Quaderno** | Nuovo modal/page con tab Dati/Cadute/Storia/Repertorio. | 1 giorno |

Totale stimato: **8-9 giorni di lavoro Sonnet** con Opus che dirige, in
parallelo dove possibile.

---

## Appendice: lo schema in una pagina

```
TAVOLO (home /)
   │
   │  Nonno parla (3-4 frasi, contesto giornaliero)
   │  [ Sediamoci ]                                          📓 → QUADERNO (tab)
   │
   └─→ SESSIONE
        │
        ├─ REVIEW momento 1 di 3
        │   - contesto: 4 mosse prima + tempo speso
        │   - posizione critica
        │   - Nonno commenta con: tempo, p_maia, waiting_moves
        │   [ Avanti ]
        │
        ├─ REVIEW momento 2 di 3
        ├─ REVIEW momento 3 di 3
        │
        ├─ PARTITA pratica vs MAIA target
        │   - posizione da turning point reale
        │   - undo "Ripensaci" sempre
        │   - SureCheck su blunder
        │   - chiusura
        │
        └─ SALUTO Nonno
            [ Vai e respira ]
            → torna al TAVOLO
```

E fuori dalla sessione:

```
LUNEDÌ 9:00  → email Nonno
DOPO PARTITA → push Nonno ("la vediamo?")
APRI APP     → Nonno saluta + brief della settimana sul Tavolo
```

Tutto qui. Quando ci dimentichiamo cosa è il prodotto, torniamo a questo
schema.
