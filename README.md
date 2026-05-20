# Mygotham — il mio Chess Coach personale

Strumento quotidiano per analizzare le mie partite di Chess.com con Stockfish e
mostrarmi **dove sbaglio in modo sistematico** — fase di gioco, motivo tattico,
aperture, time class — con l'obiettivo dichiarato di:

> **Arrivare a 1600 ELO blitz entro il 31/12/2026** (`breaking_plays2`)

```
┌─────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│  1. INGESTION   │──▶│  2. ANALYSIS     │──▶│  3. DASHBOARD       │
│  Chess.com API  │   │  Stockfish +     │   │  React + Recharts   │
│  → PGN grezzi   │   │  python-chess    │   │  + react-chessboard │
│                 │   │  → metrics.json  │   │  + drill-down       │
└─────────────────┘   └──────────────────┘   └─────────────────────┘
```

Tre strati disaccoppiati. Rilancia uno qualsiasi senza rifare gli altri.

---

## Cosa fa la dashboard

| Sezione | A cosa serve |
|---|---|
| **🎯 Goal tracker 1600** | Barra di progresso rating attuale → target, ritmo finora vs richiesto, proiezione, gap performance |
| **KPI** | ACPL ultime 30, win rate, % blunder, Elo atteso last-20 |
| **Review di oggi** | 5 blunder scelti deterministicamente per la data di oggi · scacchiera con mossa giocata (rosso) vs mossa migliore (verde) · motivo tattico · link Chess.com |
| **Cosa dicono i tuoi dati** | 3–7 frasi di coaching deterministiche basate sui tuoi pattern |
| **📈 Elo atteso** | Linea rating ufficiale vs performance rating mobile (window 20) per cadenza, con linea target |
| **Trend ACPL · per mese** | Sto migliorando? ACPL area + blunder barre |
| **Dove sbaglio · per fase** | Il grafico chiave: imprecisioni/errori/blunder per apertura/mediogioco/finale |
| **Bianco vs Nero · Per cadenza · Motivi tattici** | Tre dimensioni di confronto |
| **Heatmap del momento del blunder** | Mossa × fase, intensità = blunder count |
| **🩸 Le tue peggiori partite** | Top per "ugliness" (ACPL + blunder × 50). Clicca riga → drill-down con scacchiera navigabile + grafico eval per ply |
| **🧠 Blunder review · banca posizioni** | Tutti i blunder filtrabili per fase e motivo, paginati, con scacchiera |
| **Aperture · performance** | Sortable per partite/win-rate/ACPL/blunder, separabile per colore |

**Drill-down partita**: clicca una riga di "Le tue peggiori partite". Si apre un
modal con scacchiera (← → per navigare i ply, freccia rossa = tua mossa, verde =
migliore), grafico della valutazione clickabile, lista mosse con codice colore.

---

## Prerequisiti

- Python 3.11+
- Node 18+ (Vite + React 19)
- **Stockfish** (vedi sotto)

Username Chess.com già impostato in [config.yaml](config.yaml).

---

## Installazione Stockfish

L'analisi gira tutta in locale: serve il binario UCI.

### Windows · binario portable (consigliato)
```powershell
# Scarica e mette in engine/
Invoke-WebRequest "https://github.com/official-stockfish/Stockfish/releases/download/sf_17/stockfish-windows-x86-64-avx2.zip" -OutFile engine\stockfish.zip
Expand-Archive engine\stockfish.zip engine\
Copy-Item engine\stockfish\stockfish-windows-x86-64-avx2.exe engine\stockfish.exe -Force
```

### Linux/macOS
```bash
sudo apt-get install -y stockfish   # Debian/Ubuntu
brew install stockfish              # macOS
```

### Path esplicito (override)
Copia `.env.example` in `.env` e imposta `STOCKFISH_PATH=...`.

---

## Setup locale

```powershell
.\run.ps1 setup       # crea venv, installa python deps + npm install
```

Linux/macOS/WSL: `make setup`.

---

## Pipeline

```powershell
.\run.ps1 fetch                # scarica nuove partite (idempotente)
.\run.ps1 analyze              # analizza con Stockfish (profilo 'fast', ~3s/partita)
.\run.ps1 analyze -Deep        # profilo 'deep' (depth 22, ~5× più lento)
.\run.ps1 analyze -Limit 30    # solo ultime 30 partite (utile per provare)
.\run.ps1 metrics              # ricostruisce data/metrics.json + copia in frontend/public
.\run.ps1 dashboard            # avvia il frontend su http://localhost:5173

.\run.ps1 all                  # pipeline completa
```

Equivalente Unix: `make fetch | analyze [DEEP=1] [LIMIT=N] | metrics | dashboard | all`.

**Stima**: depth=15 → ~3s/partita su 4 core → ~6 minuti per 500 partite. Cache
hash-based: cambiare profilo o soglie invalida solo le partite toccate.

---

## Uso quotidiano (cosa faccio ogni mattina)

1. **Apro la dashboard** (locale o gh-pages — vedi sotto).
2. **Guardo il goal tracker**: sono on-track? Se no, di quanto sto sotto?
3. **Faccio "Review di oggi"**: 5 posizioni, provo a trovare la mossa giusta a mente, poi confronto con quella suggerita. Cambia ogni giorno.
4. **Guardo i motivi tattici**: dove sbaglio di più? Se "Pezzo lasciato" è dominante → tactics trainer su Lichess. Se "Errore posizionale" → studio strategico.
5. **Drill-down su 1-2 peggiori partite recenti**: vado posizione per posizione sui blunder, capisco perché ho giocato così.
6. **Decido cosa allenare oggi** e lo faccio (Lichess puzzles, partita lunga, opening review).

Il senso è: **non perdere mai più di 10 minuti al giorno qui, ma essere sempre allineato**. La dashboard è il dashboard di un product manager con se stesso.

---

## Deploy su GitHub Pages (refresh giornaliero automatico)

Il repo include una **GitHub Action** [.github/workflows/refresh-and-deploy.yml](.github/workflows/refresh-and-deploy.yml) che:

1. Gira **tutti i giorni alle 04:00 UTC** (`cron: "0 4 * * *"`) + a ogni push su `main` + manualmente da Actions UI
2. Installa Stockfish via `apt-get`
3. Riusa la cache delle partite/analisi (così analizza solo le nuove)
4. Lancia `ingest.py → analyze.py → metrics.py → export_analysis.py`
5. Builda il frontend con `VITE_BASE=/mygotham/` (per gli asset)
6. Deploya su `gh-pages`

### Prima volta — setup (3 minuti)

1. **Crea il repo nuovo** su <https://github.com/new>:
   - Owner: `leandronesi`
   - Name: `mygotham` (o quello che preferisci — se cambi, aggiorna `VITE_BASE` nel workflow)
   - Empty (no README, no .gitignore)

2. **Push del repo locale** (da PowerShell, nella cartella `Mygotham/`):
   ```powershell
   git remote add origin https://github.com/leandronesi/mygotham.git
   git branch -M main
   git push -u origin main
   ```

3. **Abilita GitHub Pages**: in repo → Settings → Pages → Source = "GitHub Actions".

4. Il workflow parte da solo al primo push. URL finale:
   <https://leandronesi.github.io/mygotham/>

### Manutenzione

- **Refresh manuale**: tab Actions → "Refresh & Deploy" → "Run workflow"
- **Analisi deep on-demand**: stesso pulsante con input `deep=true` (ci mette 5× più tempo)
- I dati di analisi (PGN + cache) vivono nella **GitHub Actions cache**, non nel repo — il repo resta leggero (~1 MB di metrics.json committato).

---

## Configurazione

In [config.yaml](config.yaml), commentato:

```yaml
chess_com:
  username: breaking_plays2
  last_n_months: null         # null = tutto lo storico

stockfish:
  threads: 1                  # per istanza (×N worker)
  hash_mb: 64                 # per istanza (RAM = workers × hash_mb)

analysis:
  fast: { depth: 15 }
  deep: { depth: 22 }
  parallel_workers: 0         # 0 = auto (cap a 4)

  thresholds:                 # ↓ ritocca queste se vuoi essere più/meno severo
    inaccuracy: 50
    mistake:    100
    blunder:    250

  phases:                     # definizione "apertura" / "finale"
    opening_until_move: 12
    endgame_material_threshold: 24
```

---

## Architettura file

```
mygotham/
├── SPEC.md                  # spec originale
├── README.md                # questo file
├── config.yaml              # username, soglie, parametri
├── .env.example
├── Makefile · run.ps1
├── .github/workflows/refresh-and-deploy.yml
├── backend/
│   ├── config_loader.py     # carica config + risolve Stockfish
│   ├── ingest.py            # §1 Chess.com → PGN + index.json
│   ├── analyze.py           # §2 Stockfish (best move, PV, motif, FEN, multiprocess)
│   ├── metrics.py           # §2 aggregati → metrics.json (KPI, goal, perf rating, motifs, top blunders…)
│   ├── export_analysis.py   # copia data/analysis in frontend/public/analysis (per drill-down statico)
│   ├── server.py            # FastAPI opzionale
│   └── requirements.txt
├── data/
│   ├── raw/                 # PGN grezzi (gitignored, riempito da ingest)
│   ├── analysis/            # cache analisi per-partita (gitignored, rigenerato da analyze)
│   ├── index.json           # gitignored
│   └── metrics.json         # committed (per primo deploy)
└── frontend/
    ├── public/metrics.json  # copia per consumo statico
    ├── public/analysis/     # gitignored, rigenerato in CI
    └── src/
        ├── App.tsx          # root: assembla tutto
        ├── data.ts · filters.ts · types.ts · chess-utils.ts
        ├── index.css        # palette + Tailwind v4
        └── components/      # GoalTracker, EloAttesoChart, DailyReview, BlunderReview,
                             # BlunderCard, BoardView, GameDetail, TacticsMotifs,
                             # WorstGames, TrendChart, PhaseChart, ColorChart,
                             # TimeClassChart, HeatmapChart, OpeningsTable, Kpi, Header,
                             # InsightsCard, FiltersBar
```

---

## Roadmap (cose che farei dopo)

- **DB SQLite** sotto `data/coach.db` per query ad-hoc (puzzle generator, ricerca per FEN/posizione)
- **Auto-detection del tilt**: sequenze di partite con ACPL crescente / perdite consecutive
- **Opening Explorer**: per ogni mia apertura, varianti più comuni nei top-1000 + dove ne esco
- **LLM coach** sopra i pattern aggregati (1 call al giorno, no per-mossa) per coaching narrativo
- **Mobile app** con notifica push del "blunder del giorno"
- **Confronto rating-class**: come sbagliano i 1600 vs come sbaglio io
