# Chess Coach — Visione di prodotto v3

> Scritto il 22/05/2026 dopo conversazione con lndrns. **Stato attuale = 20%**.
> Questo documento descrive il prodotto al 100%. È deliberatamente diverso
> dalla v2 (che è una dashboard analitica). La v3 è un **coach che ti dice
> dove sei nel tuo livello e cosa allenare**.

---

## 1. Onestà sull'attuale (cosa non funziona)

La v2 oggi:
- È uno **scrollone** di 9 sezioni senza gerarchia di lettura.
- Misura tutto sulle **mosse singole**, non sui temi. Quindi vede "pezzo
  lasciato" come una categoria grezza, non come "8 volte stessa pattern
  geometrica con la donna in d4".
- Usa **Maia come check binario** (`avoidable_at_my_level: 1/0`), non come
  protagonista. Ho 3937 chiamate Maia ma estraggo solo `argmax`, butto via la
  distribuzione di probabilità — che è IL dato.
- ACPL e blunder rate sono **misurati senza pesare la difficoltà**. Risultato:
  ogni metrica mescola "mosse che NON dovrei sbagliare alla mia forza" con
  "mosse che neanche un 1600 trova facilmente". È rumore travestito da
  segnale.
- Le **prime 3 mosse di apertura** (libro standard) finiscono spesso nei
  blunder critici per via di soglie cp_loss grezze. Sbagli col `cp_loss=200`
  alla mossa 3 NON sono un problema da coaching, è errore di filtro mio.
- Niente analisi per **apertura → mediogioco → finale → conversion** come
  sequenza. Solo "blunder per fase" come aggregato anonimo.
- Niente analisi per **tema tattico vero** (forchetta, infilata, deflessione,
  ottava traversa, sovraccarico). Solo 5 motivi regole-based.

Punto: ho il motore (DB, Maia inferenza, frontend, deploy), non ho il
prodotto.

---

## 2. La cosa che cambia tutto · la difficoltà è la moneta

**Tutto si pesa per difficoltà**. Ogni ACPL, ogni blunder, ogni "agreement",
ogni curva nel tempo — tutto guarda la difficoltà della singola posizione.

### Definizione operativa

Per ogni posizione critica:
- `difficulty = 1 − P(mossa_giusta_Stockfish | Maia@mio_livello)` ∈ [0, 1]
- `expected_correct_at_my_level = P(mossa_giusta | Maia@mio_livello)`
- `expected_correct_at_target = P(mossa_giusta | Maia@target_rating)`

Si estrae da Maia in **una sola call con `multipv=20`** o con
`VerboseMoveStats=true`. Costo: re-inferenza Maia (5 min), poi è un float
in DB per sempre.

### Cosa fa ogni metrica del prodotto

| Metrica vecchia | Versione pesata |
|---|---|
| ACPL totale | **Weighted ACPL** = ACPL pesato per `(1 − difficulty)`. Penalizza solo errori in mosse non difficili. |
| Blunder rate | **Avoidable blunder rate** = % di errori su mosse con `expected_correct_at_my_level > 0.5`. |
| Agreement Maia | **Performance gap** = (la tua accuracy su un campione) − (P-attesa Maia@target_rating sullo stesso campione). Negativo = sotto il tuo target. |
| Trend nel tempo | **Improvement velocity** = quanto sta scendendo il `weighted ACPL` mese su mese. Tutto il resto è varianza. |

### Filtro più severo delle "posizioni critiche"

Oggi: `|cp_before| ≤ 150 AND ply > 16 AND |cp_before| < 600`.
Domani aggiungiamo:
- `difficulty > 0.15` → escludi le mosse veramente ovvie (i 1100 le trovano già).
  Sotto questa soglia, anche se sbagli, è disattenzione pura: la conti
  separata sotto "discipline issues" (categoria di tilt/distrazione), non
  sotto "coaching tattico".

### Effetto pratico

Adesso ti dico "244 errori evitabili". Numero vuoto.
Con la difficoltà ti dico **"244 errori. Difficoltà media 0.32. Un 1200
sullo stesso campione sbaglia 195 (180 invece di 244). Un 1600 sbaglia
108. Il tuo gap col target su questo campione è di 136 errori — quello è
il numero che deve scendere."**

---

## 3. Maia come protagonista, non come check

La domanda di prodotto cambia.

**Adesso**: "Hai fatto un blunder?"
**Domani**: "**Cosa farebbe un 1600 nella tua situazione, e dove sei tu?**"

Maia non è un controllo binario. È **il benchmark vivente** che genera tutta
la narrativa. Ogni posizione, ogni partita, ogni report è incorniciato
rispetto a "i 1600 in quel campione fanno X, tu fai Y".

Esempi di micro-coaching:
- "In 47 posizioni di apertura simili a questa (struttura IQP nera, mediogioco aperto), i 1600 mantengono +0.3. Tu mantieni −0.4. È lì che perdi 0.7 di valutazione media — non in 'apertura' come categoria, in QUESTO tipo specifico di apertura."
- "Quando arrivi a +2 con donna+torre vs donna+torre, i 1600 convertono al 78%. Tu al 52%. **Quel −26pp è la tecnica che ti manca**, non un tilt generico."

Maia diventa l'oggetto di confronto in ogni schermata. È quasi un coach
secondario: "vediamo come l'avrebbe risolta Maia@1600".

---

## 4. Le unità di analisi · NON la mossa singola, ma temi/pattern/sequenze

Tutto il backend di oggi indicizza **per posizione (game_id, ply)**. È il
livello sbagliato per il coaching.

I livelli di analisi giusti per il prodotto:

### 4.1 Tema tattico

Pattern detection vera sulla geometria della posizione, con `python-chess`:
- `fork` (cavallo che attacca 2+ pezzi non difesi)
- `pin` (assoluto / relativo)
- `skewer` (infilata)
- `discovered_attack` (mossa che scopre un attacco con altro pezzo)
- `hanging_piece` (pezzo non difeso e attaccato)
- `back_rank_mate` (matto sull'ultima traversa)
- `removed_defender` (deflessione)
- `overloaded_piece` (sovraccarico)

Per ogni tema:
- in quante posizioni critiche compare
- accuracy tua vs Maia@1200 vs Maia@1600
- weighted ACPL su quel sottoinsieme
- esempi citabili (5 posizioni più rappresentative)

Adesso vede "pezzo lasciato 284 volte" come categoria.
Domani vede "**ottava traversa: 12 volte sbagliata, i 1600 la sbagliano 2.
Gap = 10 errori che dovevi vedere**".

### 4.2 Schema posizionale

Strutture pedonali e tipi di mediogioco/finale tipici:
- IQP (isolated queen pawn) — mio o avversario
- Carlsbad pawn structure
- Stonewall
- Hedgehog
- Maroczy bind
- Open Sicilian middlegame patterns
- T+P endgame (Lucena, Filidor)
- Donna vs torre
- Finale di pedoni puro

Per ogni schema: accuracy + Maia gap + esempi.

### 4.3 Apertura specifica (repertorio vivo)

Albero PGN delle tue aperture:
- Nodi colorati per accuracy
- Dove diverge la tua linea dalla teoria (libro più giocato dai master)
- Dove gli avversari ti puniscono (quale mossa al ply X ti porta in
  posizioni dove tu hai weighted ACPL > N)
- Repertorio "salute": per ogni linea, quante volte la ottieni, accuracy
  media, varianza
- Suggerimento: "in Caro-Kann main line al ply 12 esci con `Nf3?!` invece
  di `Nge2` che è la mossa-libro al tuo livello. Dei tuoi 18 punti persi
  in questa apertura, 11 vengono da qui."

### 4.4 Sequenza di partita

La partita NON è una somma di mosse. È un arco con 4 fasi:
1. **Apertura**: do you survive theory? (ply 1-15)
2. **Mediogioco**: con o senza piano (15-30)
3. **Conversione** (se sei in vantaggio decisivo: chiudi?)
4. **Salvataggio** (se sei in svantaggio decisivo: salvi?)

Già abbiamo conversion_rate e save_rate. Mancano:
- **Survival rate apertura**: % partite in cui esci dall'apertura entro
  ±0.3 di valutazione (la tua "teoria robusta").
- **Plan quality mediogioco**: weighted ACPL nel range ply 15-30 sul
  campione di partite con valutazione ±1.0 (mediogiochi reali, non
  posizioni decise).
- **Endgame technique**: weighted ACPL nei finali (`is_endgame=1`) +
  conversion + save su finali specifici (T+P, donne, alfieri opposti).

---

## 5. L'architettura del prodotto · NO scrollone

Lo scrollone va buttato. 5 viste, una sola domanda per vista.

### 5.1 HOME = "Cosa faccio oggi?"

Una schermata pulita, 30 secondi di lettura totale. Contiene SOLO:

- **Goal pill**: rating attuale → target, on/off track.
- **Una frase di coach** (gpt-5.4-mini) che racconta la diagnosi della
  settimana in 2-3 righe.
- **CTA principale**: "Inizia sessione di oggi" (5 puzzle + 2 turning
  points + 1 partita vs Stockfish). Streak visible.
- **2 numeri narrativi**:
  - "+12 vs settimana scorsa sulle posizioni di difficoltà 0.3-0.5"
  - "Conversion rate finali T+P: 41% (target 65%)"
- **Bottoni di navigazione** per le altre 4 viste.

Niente altro. Niente scroll. Vede subito cosa fare.

### 5.2 PROFILO = "Chi sono?"

- Player Card narrativa (story generata dal coach LLM, già esiste)
- Stile fingerprint: aggressivo/posizionale, aperto/chiuso, etc.
  Mostrato come radar chart 5 assi.
- Forze (3 cose) + Debolezze (3 cose), entrambe con confidence interval e
  numeri specifici.
- Confronto Maia@mio vs Maia@target: dove sono **già** al livello, dove
  sono **sotto**.

### 5.3 PATTERN = "Cosa devo imparare"

Il cuore del prodotto.

Lista dei temi tattici/posizionali ordinati per **impatto × frequenza ×
allenabilità × performance gap**. Per ognuno:
- accuracy tua, accuracy 1200 (=tu), accuracy 1600 (=target), gap
- 3 esempi cliccabili (board + mossa giusta + tua mossa + perché)
- bottone "Drilla questo tema" → genera 10 puzzle filtrati per quel pattern
- progress nel tempo del gap (settimana su settimana)

Niente più "blunder review" generico. Tutto è per pattern.

### 5.4 REPERTORIO = "Come gioco le aperture"

Albero PGN navigabile delle tue 5-10 aperture più giocate (white+black
separati). Per ogni nodo:
- frequenza (quante volte ci sei finito)
- weighted accuracy
- linea-libro più giocata dai master (Lichess explorer integration)
- la TUA linea (se diverge): cosa giochi tu, dove si paga il prezzo

Si naviga come Chess.com Explorer. Click su un nodo → vedi le tue partite
in cui sei arrivato lì, accuracy, esempi.

### 5.5 PROGRESSO = "Come sta andando"

Curve nel tempo, weighted:
- Weighted ACPL (per cadenza)
- Avoidable blunder rate
- Performance gap vs target (settimana su settimana — sta chiudendo?)
- Per ogni top-3 pattern dominante: weighted accuracy nel tempo

Niente metriche grezze. Niente curve elo "ufficiali" come metrica
primaria (rimane in subordine).

### 5.6 TRAINER (modalità a sé, non vista navigation)

Quello che già abbiamo: sessione guidata + drag&drop + PlaySession vs
Stockfish. Migliorabile con:
- difficoltà progressiva delle posizioni (curriculum)
- focus sul pattern della settimana invece che casuale
- review post-sessione: weighted accuracy + lezione

---

## 6. Cosa buttiamo via dalla v2

- **ACPL grezzo** ovunque (rimpiazzato da weighted ACPL).
- **Blunder count grezzo** (rimpiazzato da avoidable blunder).
- **TimeManagementChart su clock_seconds** (tempo rimasto): aggrega
  troppo, mescola "sai cosa fare" con "sei in panico". Resta solo
  SpeedVsErrorsChart con time spent + difficoltà.
- **Conversion / save / blow rate** come metriche standalone: diventano
  sotto-componenti della vista PATTERN per fase.
- **Insights deterministici come bullet** in fondo. Tutto narrato dal
  coach LLM.
- **Sezione "Bivi" separata** dalla "Turning points": confondevano. Ne
  resta una sola vista in PATTERN.
- **9 sezioni numerate scroll**: 5 viste navigation.

---

## 7. Maia come protagonista · concretamente come si parla all'utente

Esempi di micro-text che il coach scrive:

**STORY (v3)**:
> "Sei un giocatore che gestisce le posizioni 'facili' (difficoltà < 0.3)
> al 88%, esattamente come un 1500. Il tuo problema è nelle posizioni
> difficili (> 0.5): scendi al 31% mentre un 1600 starebbe al 58%. **Il
> tuo gap col target non è la quantità di errori, è la QUALITÀ del calcolo
> nelle posizioni critiche.**"

**PATTERN (v3)**:
> "Tema: **forchetta del cavallo**. Lo subisci 23 volte in 458 partite
> (5% delle tue posizioni critiche). Lo vedi prima il 26% delle volte. Un
> 1600 lo vede il 71%. **Il gap di 45 punti percentuali su questo tema è
> il singolo guadagno più grande disponibile per te in 4 settimane.**"

**REPERTORIO (v3)**:
> "Pirc Defense col bianco, 7 partite, 14% win rate. Al ply 7 giochi `f4`
> nel 5 partite su 7. La linea master è `Nf3` (giocata l'82% delle volte
> dai 1600+). I tuoi 5 partite con `f4` finiscono con weighted ACPL 84,
> quelle con `Nf3` (2 partite) con weighted ACPL 41. **Cambia mossa al
> ply 7. Da solo questo vale 4-6 punti di rating.**"

Quello sopra è la voce del prodotto. Specifica, numerica, comparativa,
azionabile.

---

## 8. Roadmap di transizione (4 settimane)

### Settimana 1 · La fondazione · "Difficoltà come moneta"
- Estrazione policy Maia (multipv=20 + verbose) per le 3937 posizioni critiche.
- Schema DB: aggiungo `difficulty`, `expected_correct_at_my_level`,
  `expected_correct_at_target` su ogni riga.
- Filtro nuovo: `is_critical = 1 AND difficulty > 0.15` (esclude le ovvie).
- Weighted ACPL, avoidable rate, performance gap calcolati in `player_model.py`.

### Settimana 2 · Pattern detection
- Detector tattici (Python sulla board): fork/pin/skewer/discovered/hanging/back_rank/removed_defender/overloaded.
- Detector posizionali (struttura pedonale, fase): IQP, T+P endgame, etc.
- Aggregazione per tema in `player_model.json`.
- Vista PATTERN nel frontend.

### Settimana 3 · Repertorio ad albero
- Parser PGN ad albero delle aperture (5-10 più giocate per colore).
- Integrazione Lichess Explorer per linee-libro al ply.
- Vista REPERTORIO nel frontend.
- Diagnosi "cambia mossa al ply X" come output narrativo.

### Settimana 4 · Riarchitettura UI
- 5 viste navigazione (HOME, PROFILO, PATTERN, REPERTORIO, PROGRESSO).
- Trainer come modalità a parte, non più sezione.
- Coach LLM riscritto per parlare in linguaggio v3 (difficulty-weighted, pattern-based, comparative).

---

## 9. Cosa NON è questa v3

- **Non è multi-tenant**. Resta single-user (breaking_plays2). Multi-user
  è un problema separato (Livello 3 della discussione precedente).
- **Non è una chat**. Il coach LLM produce documenti narrativi e brief,
  non conversa live. La chat è un capitolo successivo.
- **Non sostituisce Stockfish con Maia**. Stockfish resta la **verità**
  (la mossa giusta è quella che dice lui). Maia è il **benchmark umano**
  (quanto è raggiungibile a un dato livello). Lavorano insieme.
- **Non è una "PWA con notifiche push"**. Resta gh-pages statico. La
  daily review è quello che è.

---

## 10. Definizione di successo

Dopo la v3, l'utente deve dire:
1. "Capisco esattamente dove sono nel mio livello."
2. "So quale singola cosa mi farà guadagnare più punti se la chiudo."
3. "Vedo numeri specifici, non aggregati. Posso fidarmi di quello che mi
   stai dicendo perché è specifico al mio gioco."
4. "Non scrollo. Ogni schermata risponde a una sola domanda."
5. "Il coach mi parla del mio gioco, non degli scacchi in generale."

Se uno di questi 5 punti non è soddisfatto, la v3 non è pronta.

---

## 11. Sintesi in 3 righe

La v2 misura, la v3 valuta.
La v2 conta blunder, la v3 conta gap rispetto al tuo target.
La v2 mostra dati, la v3 mostra **il giocatore che diventerai se chiudi 1 pattern questa settimana**.

---

# Parte II — Dove va davvero questo prodotto

Quello sopra è la v3, il refactoring necessario. Da qui in poi è il
**prodotto vendibile**. Senza compromessi.

---

## 12. Posizione di mercato · perché esiste

### Il mercato degli amatori 1000-1800

Su Chess.com ci sono **40 milioni** di account attivi mensili. La fascia
1000-1800 — gli "amateurs seri" — è circa 8-10 milioni. Tutti quanti
fanno la stessa cosa: giocano, perdono, fanno "Game Review" (lo strumento
nativo di Chess.com), leggono "Blunder", chiudono il browser. Tornano
domani.

Il modello mentale di tutti gli strumenti esistenti (Chess.com Insights,
Aimchess, Lichess Insights, ChessBase) è lo stesso: **mostra dati,
l'utente deve interpretarli**. Funziona per il 5% che è già coach o
allena come pro. Per il 95% è una dashboard che apri e chiudi.

### Cosa fa questo prodotto che gli altri non fanno

| Cosa | Chess.com Insights | Aimchess | Lichess | Nostro |
|---|---|---|---|---|
| Misura ACPL | sì | sì | sì | **NO**, weighted by difficulty |
| Benchmark vs livello | no | parziale | no | **Maia continuo, multi-livello** |
| Coaching narrativo | no | no (bullet) | no | **LLM grounded su filesystem** |
| Pattern detection | regole | regole | no | **euristica python-chess + Maia gap** |
| Repertorio ad albero | no | no | base | **diff dalla teoria master per ply** |
| Drill personalizzato | random | random | random | **dai TUOI errori, difficulty-graded** |
| Modalità sessione guidata | no | sì (basic) | no | **20 min/giorno, evolutiva** |
| Coach LLM con grounding | no | no | no | **gpt-5.4-mini + wiki SIO-style** |

Tre cose sono *unfair advantages* veri, non incrementali:
1. **Maia come benchmark continuo**, non solo come "qui è ovvio sì/no".
2. **LLM coach grounded** sul filesystem (pattern Anthropic Skills + Karpathy).
3. **Difficoltà come moneta** — tutto pesato. Nessuno lo fa così.

Le altre 5 cose sono solo "fatte bene", non differenziali. Ma 3 unfair
advantages combinati = posizionamento.

### Il pitch in 1 frase

> "L'unica app che ti dice **come gioca uno al tuo target** in ogni
> posizione che incontri, e quanto sei lontano, posizione per posizione."

Non "ti analizza le partite". Non "ti dà puzzle". **Ti misura contro chi
vuoi diventare**.

---

## 13. Le 8 feature da costruire (in ordine, 6-9 mesi)

### M1-M2 — La v3 (vedi parte I)

La fondazione: difficoltà come moneta, 5 viste, Maia protagonista,
pattern detection di base. Da solo è già migliore di Chess.com Insights.

### M3 — Spaced repetition sui pattern di errore

Anki-like, ma per scacchi. Le posizioni dove sbagli entrano in una
**memory queue**. Ti ripropongo la stessa pattern (geometria simile, non
stessa posizione) dopo 1g, 3g, 7g, 21g. Se la chiudi → vai avanti. Se
sbagli → reset.

Il valore: **dimostri che stai imparando**, non solo che "fai puzzle".
Misura: "dopo 21 giorni, quale % dei pattern che avevi mancato vedi
ora?". Quel numero è la prova di crescita.

Stack: localStorage o backend leggero. Algoritmo SM-2 (Anki) o FSRS.

### M4 — Opponent intel pre-game

Click sul profilo dell'avversario su Chess.com → scarico le sue ultime
50 partite → ti dico:
- "Gioca Sicilian 80% col bianco, ma evita la Najdorf. La sua linea
  preferita è c3 Alapin. **Studia 15 min: c3 ti fa stare al pari, le
  altre linee perdi 0.4 di valutazione media in apertura.**"
- "Win rate da +2: 71%. **Se gli arrivi avanti, deve giocare male per
  perdere. Quindi semplifica appena hai vantaggio.**"
- "Ha tilt factor 1.8×. **Dopo un suo blunder, le sue 3 mosse seguenti
  sono catastrofiche. Cerca un contropiede, non una chiusura tecnica.**"

Coaching personalizzato sull'avversario specifico. Aimchess fa qualcosa
di simile ma molto basic. Noi lo facciamo grounded sui dati Maia.

### M5 — Live post-game in 30 secondi

Finisce una partita su Chess.com. App detecta (via API pubblica). 30
secondi dopo:
- "Hai perso al ply 31. Il bivio era al ply 27: hai giocato Nf3, dovevi
  giocare Bxh7+. Era un sacrificio difficile (difficoltà 0.78). **Un
  1600 lo trova nel 60% dei casi. Non lo conto come 'errore evitabile',
  ma se vuoi vedere il calcolo: tre ply forzati, mate al ply 31.**"

Una notifica. 30 secondi. Niente più "Game Review" da 3 minuti di scroll.

### M6 — Curriculum settimanale evolutivo

Il prodotto non aspetta che tu chieda. Decide lui:
- Lunedì-mercoledì: **forchetta del cavallo** (perché è il tuo pattern
  #1 della settimana scorsa). 5 puzzle/giorno + 2 turning points.
- Giovedì-venerdì: **transizione apertura-mediogioco** nella tua Pirc
  (perché è dove esci dalla teoria). 10 min di studio + 3 partite contro
  Stockfish da quella struttura.
- Sabato: **review** della settimana: ti dico cosa è migliorato e cosa no.
- Domenica: torneo settimanale strutturato (5 partite contro Maia@target
  per misurare il gap reale).

L'utente non sceglie cosa allenare. L'app sceglie. **Questo è il
prodotto.**

### M7 — Confronto archetipi storici

Style fingerprint del giocatore (radar 5 assi) confrontato con archetipi
master:
- "Sei un Tal-ino che gioca da Karpov 30% delle volte. Quando giochi
  posizionale (mediogioco chiuso) la tua accuracy crolla del 28%. **Il
  tuo stile naturale è aggressivo, smetti di provare a essere
  posizionale.**"

Maia ha pesi per archetipi (sperimentale). Si può fare. Brand value
enorme: "Chess.com Insights ti dice il tuo win rate. Noi ti diciamo CHI
SEI in confronto a Carlsen."

### M8 — Multi-tenant + login Chess.com

Solo dopo che il prodotto funziona. Niente prima. Pricing:
- **Free**: 1 partita/giorno analizzata, 5 drill al mese, niente coach LLM.
- **Pro (€8/mese)**: illimitato + coach LLM + opponent intel + curriculum.
- **Coach (€25/mese)**: white-label per allenatori umani, dashboard
  multi-studente, marketplace di pacchetti drill.

CAC realistico via Twitter/YouTube chess influencer: €3-8. LTV mensile €8
× 6-12 mesi = €48-96. Payback < 1 mese. Margini sani.

---

## 14. Moat · perché Chess.com non può copiarci in 6 mesi

Tre cose:

1. **Il pattern Karpathy-Anthropic (filesystem-as-orchestration + Skills)
   non è in Chess.com**. Sono un'azienda che fa scacchi, non LLM-native.
   Quando capiranno il pattern e lo riprodurranno passeranno 18 mesi. Noi
   abbiamo quel margine.

2. **La wiki coach scacchistica è IP**: 50+ concept files, 30+ pattern
   files, scritti bene. Non è AI-generated, è scrittura. Chiunque la
   copia ha 6 mesi di lavoro di un giocatore strong + UX writer. Tempo +
   talento, non solo soldi.

3. **L'integrazione Maia in produzione** (con lc0 compilato in CI, cache,
   inferenza policy) è un setup non banale. Non è ostacolo per Chess.com
   ma per startup competitor sì — barriera tecnica.

Il moat NON è il modello LLM (chiunque può pagare OpenAI). NON è
Stockfish (open source). È il PATTERN: filesystem + Maia + storytelling
italiano serio. Quella combinazione richiede una visione, non capitale.

---

## 15. La moonshot · cosa significa "vince" in 18 mesi

In 18 mesi, se eseguiamo, succede una di queste due cose:

**Scenario A · Acquisition da Chess.com**
Chess.com vede che gli utenti che provano l'app **non tornano a fare
"Game Review"** sul loro prodotto. Ne perdono engagement nella fascia
premium (Diamond). Compra l'app per integrare. Numero: $5-15M (basato su
multipli di SaaS B2C in chess: 30-60× MRR).

**Scenario B · Standalone SaaS profittevole**
10k utenti Pro × €8/mese = €80k MRR = €960k ARR. Margini lordi 70%+ (i
costi sono OpenAI + hosting). Si vive bene, si assume, si fa la chat
conversazionale, si fa la mobile app, si fa il content (YouTube
"l'IA che mi ha portato da 1200 a 1600").

In entrambi gli scenari, **la pre-condizione è la stessa**: un prodotto
che gli utenti aprono 6 giorni su 7 e dicono "non gioco senza".

Per arrivare lì:
1. **D2C marketing molto specifico**: collaborazioni con chess
   YouTubers fascia 1500-1900 (Gotham non, troppo grande; Eric Rosen
   sì, Hikaru no, Naroditsky difficile). Sponsorship dirette dei tuoi
   contenuti = utenti acquisiti a cost low.
2. **Open source la wiki KB del coach** come hook + freemium. La gente
   ne parla. SEO. "Best chess coaching app 2026" → noi.
3. **Cazzo se ci credi**: 18 mesi di iterazione continua, nessun mese
   senza nuove feature. Il momentum è il prodotto.

---

## 16. Cosa devi smettere di fare DOMANI

Onesto:

1. **Smettere di trattare il prodotto come "personal tool"**. Da oggi è
   un prodotto SaaS pre-revenue. Ogni decisione lato product passa da:
   "questa cosa sposta il churn rate?".

2. **Smettere di pushare ogni 30 secondi su gh-pages**. Loop locale
   serio, test branches, deploy ogni 2-3 giorni quando c'è qualcosa
   nuovo da mostrare. Disciplina di processo da SaaS, non da hobby.

3. **Smettere di costruire feature senza chiedersi "perché qualcuno
   pagherebbe €8/mese per questa specifica feature?"**. Se la risposta
   non c'è, non si fa. La vista PROGRESSO weighted? La gente la paga.
   Il glossario espandibile? No (utility, va benissimo, ma non vende).

4. **Smettere di trattare la visione come "vediamo dove arriviamo"**.
   La visione è: **acquisition o €1M ARR in 18 mesi**. Se non lo dici
   esplicitamente, non lo costruisci.

---

## 17. La domanda da farsi ogni settimana

> "Sto costruendo cose che fanno dire al mio utente 'sto migliorando
> perché uso questo'? O sto costruendo cose che fanno dire 'oh, bello'?"

La differenza tra le due risposte è la differenza tra acquisition e
hobby.

---

## 18. Il messaggio per Chess.com (placeholder pitch deck slide 1)

> **"Negli ultimi 12 mesi, breaking_plays2 è passato da 1166 a 1600 ELO
> blitz. Non grazie al puzzle rush. Grazie a un coach AI che gli ha detto,
> ogni giorno: ecco dove sei rispetto al tuo target, ed ecco la singola
> cosa che ti farà guadagnare 8 punti questa settimana. Noi vendiamo
> quel coach."**

Questo è lo slide 1 del pitch deck a Chess.com tra 18 mesi.
Se quella frase non è vera, abbiamo fallito.
