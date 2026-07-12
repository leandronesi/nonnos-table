# Maia in-browser — spec implementativa (M1)

**2026-05-29.** Fonte: reverse-engineering di `CSSLab/maia-platform-frontend` (branch main).
Questo è il riferimento canonico per il porting di Maia nel pipeline multi-utente browser-side.

## Modello

- **`maia3_simplified.onnx`** — 43.57 MB. Modello UNICO Maia-3 condizionato sull'ELO (NON uno per rating).
- Percorso upstream di riferimento:
  `public/maia3/maia3_simplified.onnx` in `CSSLab/maia-platform-frontend`.
  Per un upload operativo usa un URL fissato a un commit, mai il branch
  `main`, e verifica lo SHA-256 atteso prima di modificare lo Storage.
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
- Softmax sui SOLI indici legali, poi `mirrorMove` indietro se nero → `{uci: massa_policy_raw}` ordinato desc. E' una distribuzione del modello, non una frequenza umana calibrata.
- Value: WDL → `winProb = (expW + 0.5*expD)/sum`, flip se nero.

## ORT / Worker (porta da `public/maia-worker.js`)
- ORT in Web Worker, `ort.env.wasm.wasmPaths` su asset self-hosted. **GH Pages = single-thread** (niente COOP/COEP): usare il build SIMD non-threaded per evitare il requisito SharedArrayBuffer. Self-host i `.wasm` in `public/ort/`.
- Sessione creata da ArrayBuffer (model bytes). Cache in IndexedDB (`MaiaModels`/`models`), keyed `{url, version}`.
- Guard: prima di `run`, attendere `status === 'ready'`.

## Hosting
- ORT wasm → `frontend/public/ort/` (same-origin, committato).
- Il main bundle non importa `onnxruntime-web`: elabora direttamente i `Float32Array` restituiti dal worker. ORT vive solo in `public/ort/`, evitando il duplicato JSEP da ~24 MB.
- Modello → URL di runtime `VITE_MAIA_MODEL_URL`, oppure default same-origin `${BASE_URL}maia3/maia3_simplified.onnx` (niente progetto/storage personale hardcoded).
- **Il repository non include oggi il file ONNX**: il deploy deve pubblicarlo a quel path oppure impostare l'env. Se manca o non risponde, Maia e' `unavailable` e i consumer interattivi passano esplicitamente a Stockfish.

Il deploy GitHub Pages richiede la repo variable `VITE_MAIA_MODEL_URL` e la
sottopone a preflight. `MAIA_MODEL_SHA256` e `PUBLIC_SITE_ORIGIN` sono
obbligatorie: il gate scarica l'artefatto, verifica hash, redirect HTTPS e
`Access-Control-Allow-Origin` (salvo URL same-origin). Vedi il runbook nel README.

## Logica consumer (la parte "relativa al tuo livello" — da types.ts + PRODUCT_VISION)

Per ogni posizione critica, con un insieme di mosse Stockfish accettabili **osservato nelle linee MultiPV** e due policy Maia:
- `policy_mine = maia(fen, current_rating, current_rating).policy`
- `policy_target = maia(fen, target_rating, target_rating).policy`

Campi (popolano `PositionRow` / `AnalyzedMove`):
- massa della mossa giocata, separata dalla massa delle mosse buone;
- `maia_*_acceptable_observed_policy` = somma sul set MultiPV osservato (non un'enumerazione completa);
- `drill_value` = massa target osservata meno massa current osservata;
- `avoidable_at_current` = soglia euristica di supporto della policy current, mai tradotta in "potevi evitarlo";
- `target_relevant` / `trainable` = segnali separati per il percorso;
- `maia_policy_semantics = raw_policy_mass_not_calibrated_frequency`;
- sotto i 30 secondi residui, dove il training Maia-3 escludeva le mosse, `avoidable_at_current = null`.

Le ancore sono ordinate da uno score relativo di training (`training_priority_weight × impatto`). Non viene stimato alcun upside Elo.

## Avversario interattivo

- Per ogni turno avversario, Maia riceve `elo_self = elo_oppo = target_rating`.
- Il client rifiltra la policy con le mosse legali `chess.js`, rinormalizza la massa e campiona: non usa argmax fisso.
- Il rating e' passato come conditioning continuo: non imponiamo un range hardcoded senza una soglia primaria validata. Valori non numerici/non positivi e cadenze diverse da rapid/blitz attivano il fallback.
- Rapid Chess.com e' dichiarato cross-domain; blitz Chess.com e' cross-platform rispetto al training Lichess.
- Timeout, modello assente, policy invalida o massa legale zero attivano Stockfish con `opponent_source` e reason code visibili/telemetrici.

## Performance
- Single-thread WASM: batch le posizioni in pochi `session.run` (concatenazione già supportata). Nell'analisi profonda far girare Maia solo sul campione esplicitamente coperto. Nella partita interattiva usare timeout, cancellazione logica e fallback senza bloccare il thread UI.

## File da portare (raw.githubusercontent, branch main)
- `src/lib/engine/tensor.ts` · `src/lib/engine/maia.ts` · `public/maia-worker.js`
- `src/lib/engine/data/all_moves_maia3.json` + `_reversed.json`
- `src/contexts/MaiaEngineContext.tsx` (lifecycle/cache, per riferimento)
