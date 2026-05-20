# SPEC — Chess Coach personale (analisi pattern + dashboard React)

> Documento di specifica pensato per essere eseguito da **Claude Code**.
> Obiettivo: costruire un'applicazione che scarica le mie partite da Chess.com,
> le analizza con Stockfish e mi mostra in una dashboard React **i pattern
> ricorrenti delle mie debolezze nel tempo** (non la singola partita).
>
> **Da personalizzare prima di iniziare:**
> - `CHESS_USERNAME` = `<IL_MIO_USERNAME_CHESS_COM>`
> - Sistema operativo: `<macOS | Linux | Windows>`

---

## 0. Cosa deve fare in una frase

Capire **dove sbaglio in modo sistematico** — fase di gioco, aperture, colore,
gestione del tempo — e mostrarmelo con grafici di trend, così so su cosa allenarmi.

L'enfasi è sui **pattern aggregati nel tempo**, non sul commento mossa-per-mossa
della singola partita (quello è un di più, non il focus).

---

## 1. Architettura a tre strati

```
┌─────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│  1. INGESTION   │──▶│  2. ANALYSIS     │──▶│  3. DASHBOARD       │
│  Chess.com API  │   │  Stockfish +     │   │  React (frontend)   │
│  → PGN grezzi   │   │  python-chess    │   │  + API backend      │
│                 │   │  → metriche JSON │   │  → grafici trend    │
└─────────────────┘   └──────────────────┘   └─────────────────────┘
```

Tieni i tre strati **disaccoppiati**: l'ingestion salva file, l'analisi legge
quei file e produce un dataset di metriche, la dashboard legge solo il dataset.
Così posso rilanciare un singolo strato senza rifare tutto.

### Stack tecnico richiesto
- **Backend / pipeline**: Python 3.11+ con `python-chess`, `requests`, `stockfish` (o pilotaggio UCI diretto via `chess.engine`).
- **Engine**: Stockfish (Claude Code lo installa, vedi §2).
- **Frontend**: React + Vite + TypeScript. Grafici con **Recharts**. Styling con **Tailwind**. Deve essere **graficamente curato**, non un boilerplate.
- **Bridge dati**: il backend espone un piccolo server (FastAPI) che serve il dataset di metriche come JSON; in alternativa, in fase iniziale, la dashboard può leggere un `metrics.json` statico generato dalla pipeline. Parti da JSON statico, poi valuta FastAPI.

---

## 2. Setup ambiente (primo task di Claude Code)

1. Rileva il sistema operativo e **installa Stockfish**:
   - macOS: `brew install stockfish`
   - Linux/Debian: `sudo apt-get install -y stockfish`
   - Windows: scarica il binario ufficiale da stockfishchess.org e mettilo nel PATH (o in `./engine/`).
2. Verifica che Stockfish risponda (lancia un `uci` e controlla la versione). Stampa il path del binario trovato.
3. Crea un ambiente Python isolato (`venv`) e installa le dipendenze.
4. Crea la struttura cartelle (§7).
5. Metti il path di Stockfish in un file di config (`.env` o `config.yaml`), **non** hardcodato nel codice.

---

## 3. Strato 1 — Ingestion (Chess.com)

### API da usare (pubblica, niente autenticazione)
- Lista archivi mensili: `GET https://api.chess.com/pub/player/{username}/games/archives`
  → restituisce una lista di URL, uno per mese.
- Partite di un mese: `GET https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}`
  → ogni partita ha campo `pgn`, più metadati utili: `time_class` (bullet/blitz/rapid/daily), `time_control`, `rated`, colori, rating dei giocatori, risultato, `end_time`.

### Requisiti
- Imposta uno `User-Agent` descrittivo nelle richieste (Chess.com lo richiede, altrimenti rischi 403).
- Scarica **tutti** gli archivi disponibili, ma rendi configurabile un limite (es. "ultimi N mesi").
- Salva i PGN grezzi in `data/raw/` (un file per mese) + un indice `data/index.json` con i metadati.
- **Idempotenza**: se un mese è già scaricato, non riscaricarlo (salvo l'ultimo mese in corso). Gestisci il rate limit con backoff.
- Estrai e conserva per ogni partita: id/url, data, time_class, mio colore, mio rating, rating avversario, risultato (vinto/perso/patta dal mio punto di vista), ECO dell'apertura e nome apertura, numero mosse.

---

## 4. Strato 2 — Analisi con Stockfish

Questo è il cuore. Per ogni partita, ricostruisci la sequenza di posizioni e
fai valutare ogni mia mossa da Stockfish.

### Classificazione mosse
Per ciascuna **mia** mossa, confronta la valutazione della posizione prima e dopo
(dal mio punto di vista, in centipawn; gestisci i matti come valori molto alti).
La perdita di valutazione (`centipawn loss`) determina la categoria. Usa soglie
configurabili, con default sensati ispirati alle convenzioni comuni:

| Categoria      | Perdita (centipawn) indicativa |
|----------------|-------------------------------|
| Ottima/Best    | ~0–20                          |
| Imprecisione   | ~50–100                        |
| Errore         | ~100–250                       |
| Blunder        | > ~250                         |

(Le soglie esatte sono parametri in config: deve essere facile ritoccarle.)

### Performance — importante
Analizzare molte partite a profondità alta è costoso. Quindi:
- Profondità/tempo per mossa **configurabile** (es. `depth=15` o `movetime=100ms`). Default veloce, opzione "deep".
- Riusa **una sola istanza** del processo Stockfish per partita (non riavviarlo ad ogni mossa).
- Possibilità di analizzare in parallelo più partite (multiprocessing) sfruttando i core.
- **Cache**: se una partita è già stata analizzata (stesso id + stessi parametri), non rifarla. Salva i risultati per-partita in `data/analysis/`.
- Mostra una progress bar: l'analisi può durare parecchio sui primi run.

### Metriche da estrarre per ogni partita (dal MIO punto di vista)
- ACPL (average centipawn loss) totale e per fase.
- **Fase di gioco** in cui avviene ogni errore: apertura / mediogioco / finale. Definisci i confini di fase in modo ragionevole (es. apertura = prime ~10-12 mosse o finché restano i pezzi pesanti; finale = quando il materiale scende sotto una soglia). Documenta la regola scelta.
- Conteggio per categoria (imprecisioni/errori/blunder) e in quale fase.
- Apertura giocata (ECO + nome) e mio colore.
- Momento della partita in cui crollo (numero di mossa dei blunder) → utile per capire se sbaglio "presto" o "a fine partita".
- Se disponibile, correla con `time_class` (sbaglio di più in bullet?).

### Output
Un dataset aggregato `metrics.json` (+ eventuale `metrics.parquet`) pronto per la
dashboard, con sia il dettaglio per-partita sia gli **aggregati nel tempo**
(raggruppabili per mese, per apertura, per colore, per fase, per time_class).

---

## 5. Strato 3 — Dashboard React (deve essere bella)

Single-page app, curata graficamente, **dark mode** elegante, tipografia pulita,
palette coerente (non i colori di default di Recharts). Pensa a una vibe tipo
"analytics dashboard premium". Mobile-friendly ma ottimizzata per desktop.

### Viste / grafici richiesti (focus: pattern nel tempo)
1. **Header con KPI**: rating attuale per time_class, ACPL medio recente vs precedente (con freccia trend), numero partite analizzate, % blunder.
2. **Trend nel tempo** (line/area chart): ACPL medio per mese → sto migliorando?
3. **Dove sbaglio — per fase di gioco** (bar/stacked): distribuzione di imprecisioni/errori/blunder tra apertura, mediogioco, finale. Questo è IL grafico chiave dei pattern.
4. **Aperture deboli** (tabella ordinabile + bar): per apertura, partite giocate, win rate, ACPL medio, n. blunder. Evidenzia le aperture dove vado peggio, separate per colore (bianco/nero).
5. **Bianco vs Nero**: confronto performance e tipi di errore.
6. **Heatmap del momento del blunder**: in che fase/numero di mossa tendo a crollare.
7. **Filtri globali**: per time_class, intervallo di date, rated/unrated. Tutti i grafici reagiscono ai filtri.

### Insight testuali
Sopra/accanto ai grafici, una sezione "**Cosa dicono i tuoi dati**" che traduce i
numeri in 3-5 frasi di coaching in italiano (es. "Il 60% dei tuoi blunder arriva
nel mediogioco dopo la mossa 20: lavora sul calcolo nelle posizioni complesse").
Genera queste frasi via regole sui dati aggregati (semplici, deterministiche).

> Estensione futura (non ora): collegare un LLM per commenti di coaching più ricchi.

---

## 6. Comandi / esperienza d'uso

Prevedi comandi semplici (Makefile o script npm/python):
- `make fetch` → scarica/aggiorna le partite.
- `make analyze` → analizza con Stockfish (flag `--deep` per profondità alta).
- `make dashboard` → builda i dati e avvia la dashboard.
- `make all` → pipeline completa.

Un singolo comando deve poter fare tutto da zero per un nuovo utente.

---

## 7. Struttura cartelle proposta

```
chess-coach/
├── SPEC.md                  # questo file
├── README.md                # istruzioni d'uso (Claude Code lo scrive)
├── config.yaml              # username, soglie, path stockfish, parametri analisi
├── .env.example
├── Makefile
├── backend/
│   ├── ingest.py            # strato 1
│   ├── analyze.py           # strato 2 (Stockfish)
│   ├── metrics.py           # aggregazione → metrics.json
│   ├── server.py            # FastAPI opzionale (fase 2)
│   └── requirements.txt
├── data/
│   ├── raw/                 # PGN grezzi per mese
│   ├── analysis/            # risultati per-partita (cache)
│   ├── index.json
│   └── metrics.json         # dataset per la dashboard
└── frontend/                # React + Vite + TS + Tailwind + Recharts
    └── src/...
```

---

## 8. Vincoli e cura

- Codice **commentato nei punti chiave** (soglie, definizione delle fasi, parametri Stockfish): voglio poterci mettere mano.
- Niente segreti hardcodati; username e parametri in `config.yaml`.
- Gestione errori robusta su rete (Chess.com a volte rallenta) ed engine.
- README con: prerequisiti, come settare lo username, come lanciare ogni step, quanto tempo aspettarsi per l'analisi, come cambiare la profondità.
- Il primo run deve funzionare end-to-end anche con poche partite, per vedere subito qualcosa nella dashboard.

---

## 9. Ordine di esecuzione consigliato per Claude Code

1. Setup ambiente + installa e verifica Stockfish (§2).
2. Implementa ingestion, scarica un paio di mesi, verifica i PGN (§3).
3. Implementa analisi su poche partite a profondità bassa, verifica le metriche (§4).
4. Genera `metrics.json` aggregato (§4 output).
5. Monta la dashboard React con dati reali, un grafico alla volta (§5).
6. Rifinisci grafica, filtri, insight testuali.
7. Scrivi README e comandi `make` (§6).
8. Solo dopo: alza la profondità di analisi e gira su tutto lo storico.

> Nota su Stockfish: è il motore open source più forte al mondo ed è ciò che dà
> autorevolezza all'analisi. La profondità è il principale compromesso
> tempo/qualità — parti basso per iterare, poi alza.
