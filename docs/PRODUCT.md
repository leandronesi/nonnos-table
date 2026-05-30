# Mygotham · Road to GranPa — Product Manifesto

**Versione 1.0 — 2026-05-25**
Documento canonico. Quando una decisione di prodotto è incerta, si torna qui.

---

## 0. Aggiornamento 2026-05-29 — evoluzione del modello

Due decisioni del PO che EVOLVONO questo manifesto. Dove confliggono con §5, §6 e la regola §11.4, prevale quanto segue.

### 0.1 "Ancore", non "freni"

Il cuore non è una lista di debolezze (colpa), ma le tue **ancore**: ciò che ti tiene fermo al tuo livello. Il framing guarda in avanti: ogni ancora si esprime con l'UPSIDE, "lasciala e sali verso X", non "qui sbagli". L'unità resta quella della Vision (pattern, posizioni, comportamenti, pesati per difficoltà Maia e relativi al target), ma nome ed espressione sono motivazionali: quanto guadagni se la molli.

### 0.2 Dati esposti, Nonno è l'interprete (non il narratore)

Si abbandona il "Nonno + 1 bottone, tutti i dati dietro 📓" (§5-6, regola §11.4). Il **dato e i grafici sono il protagonista** (esponi il valore). **Nonno è un di cui**: il layer che ti aiuta a LEGGERE i dati su richiesta. Clicchi un grafico che non capisci, lui ti dice cosa vuol dire e cosa farci. On-demand, non un monologo che fa da cancello.

### 0.3 Flusso della Sessione: guardo → Nonno aiuta → gioco da solo → partita

La Sessione e' una progressione pedagogica (io guardo, facciamo insieme, faccio da solo, gioco), NON solo review passivo. I drill attivi TORNANO. Quattro fasi:
1. **Guardo + Nonno parla**: rivedo la posizione, Nonno la commenta (tempo, "1 su 10 al tuo livello", mossa d'attesa). Passivo.
2. **Nonno mi aiuta**: trovo la mossa con l'aiuto di Nonno (hint visivo, casa di partenza). Guidato.
3. **Gioco da solo**: trovo la mossa senza aiuto. Drill.
4. **Partita**: gioco contro Maia al target, da una mia posizione vissuta.

### 0.4 Note di prodotto

Il resto del manifesto (lessico §17, le 3 firme §10, il loop temporale §13) resta valido. Cambiano il PESO di Nonno (da protagonista a interprete CHE PERO' ti accoglie con un racconto all'ingresso, §6) e il NOME del cuore (ancore).

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
quanto tempo hai speso sulla mossa, sapere quanti giocatori al tuo
livello avrebbero trovato la mossa giusta, e quando invece **conveniva
giocare di attesa** perché la mossa esatta era troppo difficile per te.

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
│   poteva. Poi giochiamo una contro un 1500.  │
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
│  Solo 1 su 8 al tuo livello l'avrebbe trovata. │
│  Per un 1500 era già più chiara.               │
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
- Tempo, probabilità MAIA mine vs target, alternative "di attesa" sono
  parte del **discorso di Nonno**, non statistiche affiancate.
- Una sola CTA: "Avanti". Niente "Salta", niente "Tutorial", niente
  "Spiegami di più".

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

> *"Solo 1 su 8 al tuo livello l'avrebbe trovata. Per un 1500 era già più
> chiara."*

`p_maia_mine_top` e `p_maia_target_top` già in PositionRow. Mai mostrati.

### C. Il consiglio della "mossa di attesa"

Quando la mossa giusta è oggettivamente **troppo difficile** per il livello
(p_maia_mine_top < 0.20) E la posizione **non è forzante** (non c'è una
tattica obbligata), Nonno insegna una strategia:

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
   numeri concreti (tempo, "1 su 8 al tuo livello") come argomento del coach.
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
