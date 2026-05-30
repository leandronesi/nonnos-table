# Maia in-browser — spec implementativa (M1)

**2026-05-29.** Fonte: reverse-engineering di `CSSLab/maia-platform-frontend` (branch main).
Questo è il riferimento canonico per il porting di Maia nel pipeline multi-utente browser-side.

## Modello

- **`maia3_simplified.onnx`** — 43.57 MB. Modello UNICO Maia-3 condizionato sull'ELO (NON uno per rating).
- Download libero: `https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/main/public/maia3/maia3_simplified.onnx`.
- Pesi full PyTorch (316 MB, `UofTCSSLab/Maia3-79M` su HF) NON servono: l'ONNX simplified è autosufficiente. `maia2`/`maia3` repo sono solo PyTorch, niente browser.

### Input / output della sessione ONNX
- `tokens` float32 `[B, 64, 12]` — board tokens (vedi encoding).
- `elo_self` float32 `[B]` — ELO del giocatore al tratto (raw float, NON bucket).
- `elo_oppo` float32 `[B]` — ELO avversario (raw float).
- Output `logits_move` (4352 per item) + `logits_value` (3 per item: L/D/W).

## Encoding (porta verbatim da `src/lib/engine/tensor.ts`)
- Se nero al tratto: `mirrorFEN` (specchia ranghi + scambia colori + castling + en-passant + active color) → il modello vede SEMPRE dal lato Bianco.
- `boardToMaia3Tokens`: `Float32Array(64*12)`, layout `square*12 + pieceIdx`, `square = row*8+file` con `row = 7-rank` (a1 = row 0). Ordine pezzi: `P N B R Q K p n b r q k`. Nessun piano metadata (solo i 12 canali pezzo).
- Legal mask: lunghezza 4352, `legalMoves[allPossibleMovesMaia3[from+to+promo]] = 1`.
- Ignora il path legacy 18-plane (`preprocess`, `all_moves.json` 1880, `mapToCategory`).

## Decoding (porta verbatim da `processOutputsMaia3` in `src/lib/engine/maia.ts`)
- Vocab mosse: `src/lib/engine/data/all_moves_maia3.json` (4352, `{uci:index}`) + `_reversed`.
- Softmax sui SOLI indici legali, poi `mirrorMove` indietro se nero → `{uci: prob}` ordinato desc.
- Value: WDL → `winProb = (expW + 0.5*expD)/sum`, flip se nero.

## ORT / Worker (porta da `public/maia-worker.js`)
- ORT in Web Worker, `ort.env.wasm.wasmPaths` su asset self-hosted. **GH Pages = single-thread** (niente COOP/COEP): usare il build SIMD non-threaded per evitare il requisito SharedArrayBuffer. Self-host i `.wasm` in `public/ort/`.
- Sessione creata da ArrayBuffer (model bytes). Cache in IndexedDB (`MaiaModels`/`models`), keyed `{url, version}`.
- Guard: prima di `run`, attendere `status === 'ready'`.

## Hosting
- ORT wasm → `frontend/public/ort/` (same-origin, committato).
- Modello → default `frontend/public/maia3/maia3_simplified.onnx` (same-origin = niente CORS/CORP, più robusto su GH Pages). Alternativa: Supabase Storage via `VITE_MAIA_MODEL_URL` (cross-origin OK in single-thread). URL configurabile via env.

## Logica consumer (la parte "relativa al tuo livello" — da types.ts + PRODUCT_VISION)

Per ogni posizione critica, con `bestMoveUci` da Stockfish e due policy Maia:
- `policy_mine = maia(fen, current_rating, current_rating).policy`
- `policy_target = maia(fen, target_rating, target_rating).policy`

Campi (popolano `PositionRow` / `AnalyzedMove`):
- `p_mine_plays_best_sf = policy_mine[bestMoveUci] ?? 0`
- `p_target_plays_best_sf = policy_target[bestMoveUci] ?? 0`
- `p_maia_mine_top = max(policy_mine)` · `p_maia_target_top = max(policy_target)`
- `move_difficulty = 1 - p_maia_target_top` (ambigua anche per il target)
- `drill_value = p_target_plays_best_sf - p_mine_plays_best_sf` (il "money": il target la trova, tu no)
- `priority_score`:
  - `0` SKIP se `move_difficulty < 0.15` (ovvia → disciplina, conta a parte) OPPURE mossa di libro OPPURE `p_target_plays_best_sf < 0.5` (nemmeno il target la trova → non è un tuo freno, è il prossimo gradino)
  - `3` MONEY se `drill_value >= 0.25`
  - `2` EVITABILE se `p_mine_plays_best_sf >= 0.5` (al tuo livello la trovavi → disattenzione)
  - `1` altrimenti (errore critico raw)
- `waiting_moves`: quando `p_maia_mine_top < 0.20` (nessuna mossa ovvia PER TE) e la posizione non è forzante → alternative Stockfish multipv con `cp_loss < 50`, non catture/scacchi.

Le **ancore** (M2) = cluster di posizioni con `priority_score >= 2`, raggruppate per natura (pattern tattico / schema posizionale / comportamento), ordinate per `Σ(drill_value × impatto)`, espresse con l'UPSIDE ("lasciala e sali di ~X").

## Performance
- Single-thread WASM: batch le posizioni in pochi `session.run` (concatenazione già supportata). Far girare Maia SOLO sulle posizioni critiche (errori + near-critical), non su ogni mossa. Mostrare loader onesto (è il giro di analisi profonda, non interattivo).

## File da portare (raw.githubusercontent, branch main)
- `src/lib/engine/tensor.ts` · `src/lib/engine/maia.ts` · `public/maia-worker.js`
- `src/lib/engine/data/all_moves_maia3.json` + `_reversed.json`
- `src/contexts/MaiaEngineContext.tsx` (lifecycle/cache, per riferimento)
