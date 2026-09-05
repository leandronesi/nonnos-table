/**
 * Analyze pipeline browser-side (lazy port, vedi memory architecture-zero-worker).
 *
 * Per ogni partita `pending`:
 *   1. Scarica il PGN da Storage.
 *   2. Itera mossa per mossa (con chess.js) dal punto di vista del player.
 *   3. Stockfish depth 12 sul FEN PRE-mossa player.
 *   4. Stockfish depth 12 sul FEN POST-mossa player.
 *   5. cp_loss = max(0, eval_before - eval_after_dal_mio_pov).
 *   6. Classifica: blunder >= 250, mistake >= 100, inaccuracy >= 50.
 *   7. Tagga la fase (opening/midgame/endgame) con regole semplici.
 *   8. Salva analysis JSON su Storage + aggiorna `games.analysis_status='done'`.
 *
 * Questa fase usa MultiPV osservato (attualmente 2 linee) per un set
 * accettabile esplicitamente incompleto e registra segnali fattuali su clock,
 * criticita' ed errori. Maia gira successivamente in aggregate.ts.
 */

import { Chess } from "chess.js";
import { supabase } from "../auth/supabaseClient";
import { downloadText, uploadJson } from "../auth/storage";
import { analysisPath } from "../auth/storage";
import type { GameRow } from "../auth/db.types";
import { createStockfishPool, StockfishEngine } from "./stockfishWorker";
import { FREE_GAME_CAP } from "./config";
import type { AnalyzedTimeClass } from "./config";
import {
  advanceAnalysisProgress,
  analysisWorkItems,
  isPersistedAnalysisSuccess,
  requireAnalysisRows,
  type AnalysisProgressCounts,
} from "./analysisRunSemantics";
import type { MotifOccurrence, TransferMotifType } from "../types";
import {
  acceptableObservedMovesFromEvaluation,
  computeSpentSeconds,
  isCriticalPosition,
} from "./analysisSemantics";
import { extractMoves } from "./pgnExtract";
import { parseClockControl } from "./decisionTiming";
import { classifyErrorSemantics } from "./errorSemantics";
import type { ErrorEvidence, ErrorSignal } from "./errorSemantics";
import { LeaseOwnershipLostError } from "./jobLease";

const DEPTH = 12;
const TH_INACC = 50;
const TH_MIST = 100;
const TH_BLUN = 250;
const OPENING_UNTIL_MOVE = 12;
const ENDGAME_MATERIAL_THRESHOLD = 24; // come backend/config.yaml
/** Quante mosse precedenti conservare come contesto pre-errore (entrambi i colori). */
const PREV_MOVES_CONTEXT = 4;

async function updateGameRequired(
  gameId: string,
  patch: Partial<GameRow>,
  code: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("games")
    .update(patch)
    .eq("id", gameId)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error(`${code}:${error?.message ?? "missing_row"}`);
}

async function persistAnalyzeProgress(
  jobId: string,
  leaseToken: string,
  processed: number,
  required: boolean,
): Promise<void> {
  const { data, error } = await supabase.rpc("patch_ingest_job_lease", {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_patch: { games_done: processed },
  });
  if (error) {
    const message = error.message;
    if (required) throw new Error(`analysis_progress_checkpoint_failed:${message}`);
    // eslint-disable-next-line no-console
    console.warn("[analyze] intermediate progress checkpoint skipped");
    return;
  }
  if (data !== true) throw new LeaseOwnershipLostError();
}

type MoveCategory = "ok" | "inaccuracy" | "mistake" | "blunder";
type Phase = "opening" | "middlegame" | "endgame";

export type StateBefore = "winning" | "equalish" | "losing";
export type TimeState = "zeitnot" | "rushed" | "long_think" | "normal";

export interface AnalyzedMove {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  scoreBeforeCp: number;        // dal punto di vista del player al tratto
  scoreAfterCp: number;          // dal punto di vista del player (post-mossa)
  cpLoss: number;
  category: MoveCategory;
  phase: Phase;
  bestMoveUci: string | null;
  /**
   * Mosse candidate Stockfish entro ACCEPTABLE_MOVE_CP_LOSS dalla linea migliore.
   * Campo opzionale per compatibilita' con i JSON di analisi precedenti.
   */
  acceptableObservedMoveUcis?: string[];
  /** Numero di linee MultiPV effettivamente osservate per costruire il set. */
  acceptableSetMultiPv?: number;
  /** false: il set e' limitato alle linee MultiPV osservate (attualmente 2). */
  acceptableMovesComplete?: boolean;
  /**
   * Posizione contendibile (|eval| <= 150cp) e fuori dai primi 16 ply.
   * Non significa semplicemente "il giocatore e' in vantaggio".
   */
  isCritical?: boolean;
  /** Secondi spesi dal player su questa mossa (da [%clk] nel PGN). null se non disponibile. */
  spentSeconds: number | null;
  /** Clock rimasto (secondi) DOPO questa mossa del player, da [%clk] PGN. null se assente. */
  clockRemaining: number | null;
  /** Clock at the start of this decision, before thinking or increment. */
  clockBeforeSeconds?: number | null;
  /** Used to exclude forced moves from decision-speed patterns. */
  legalMoveCount?: number;
  /** Opportunity motif detected regardless of the player's move quality. */
  opportunityMotif?: TransferMotifType;
  /** Motif tattico rilevato (v1 conservativo). null se non sicuro o mossa ok. */
  motif: string | null;
  /**
   * Difficoltà oggettiva della posizione PRE-mossa (0..1).
   * 1.0 = mossa unica (gap fra 1a e 2a linea >= 200cp).
   * 0.0 = molte mosse equivalenti (gap ~ 0).
   * null = non calcolabile (mate nelle lines o meno di 2 linee disponibili).
   */
  /** @deprecated Alias di stockfishChoiceGap per JSON/lettori precedenti. */
  moveDifficulty: number | null;
  /** Gap normalizzato fra le prime due linee Stockfish osservate. */
  stockfishChoiceGap?: number | null;
  /** Ultima mossa dell'avversario immediatamente prima di questa mossa del player. */
  last_opp_from: string | null;
  last_opp_to: string | null;
  last_opp_san: string | null;
  /**
   * Le mosse SAN che hanno portato qui, in ordine cronologico ed entrambi i
   * colori: il "film invece della fotografia" del §7. Popolato SOLO sulle mosse
   * che possono diventare esempi (blunder/mistake), per non gonfiare i JSON di
   * analisi con contesto che nessuno leggera'.
   * Assente nelle analisi precedenti a questo campo.
   */
  prevMoves?: string[];
  // ── Campi derivati (A3) ─────────────────────────────────────────────────────
  /** Stato della posizione PRIMA della mossa dal pov del player. */
  stateBefore: StateBefore;
  /** Stato del tempo su questa mossa. null se nessun clock o partita daily. */
  timeState: TimeState | null;
  /** Categoria di errore (albero decisionale). null per mosse non-errore (cpLoss < 100). */
  errorType: string | null;
  /** Signal fattuali multi-label; assenti nei JSON storici. */
  errorSignals?: ErrorSignal[];
  /** Evidenza grezza usata per la classificazione conservativa. */
  errorEvidence?: ErrorEvidence | null;
  /** Mapping del primary category alla tassonomia precedente. */
  legacyErrorType?: string | null;
  /** Euristica di ordinamento; non attribuisce la causa dell'errore. */
  trainabilityWeight?: number | null;
  /** Peso di allenabilità 0..1. null per mosse non-errore. */
  blameWeight: number | null;
  /** cpLoss pesato per l'impatto reale (ridotto se eri già perso). null per non-errore. */
  impact: number | null;
}

export interface GameAnalysis {
  game_id: string;
  chess_com_uuid: string;
  played_at: string;
  color: "white" | "black";
  result: "win" | "loss" | "draw";
  time_class: string;
  total_player_moves: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  avg_cp_loss: number;
  by_phase: Record<Phase, { moves: number; blunders: number; mistakes: number; inaccuracies: number; avg_cp_loss: number }>;
  moves: AnalyzedMove[];
  /** ECO code estratto dall'header PGN (es. "B12"), null se assente. */
  eco: string | null;
  /** Opening name estratto dall'header PGN, null se assente. */
  opening: string | null;
  /** URL Chess.com della partita, dall'header PGN [Link]. null se assente. */
  game_url: string | null;
  /**
   * Secondi base del time control (es. 600 per 10 min, 180 per 3 min).
   * null per partite daily/correspondence o senza TimeControl header.
   */
  time_control_base_seconds: number | null;
  /** Absent in legacy analyses; never interpret absence as zero increment. */
  time_control_increment_seconds?: number | null;
  /**
   * Pattern-occurrence records for EVERY critical player position (§7.2 BUILD.md).
   *
   * "Critical" = a player move that we fully evaluated (all analyzed moves).
   * Motif is classified heuristically via chess.js geometry from the best move.
   * `handled` = cp_loss < HANDLED_CP_THRESHOLD (50): the player dealt with the situation.
   *
   * Used by aggregate.ts to compute transfer metrics (faced/handled/rate).
   * Absent on old analysis files (treated as [] in aggregate).
   */
  motif_occurrences?: MotifOccurrence[];
}

function classify(cpLoss: number): MoveCategory {
  if (cpLoss >= TH_BLUN) return "blunder";
  if (cpLoss >= TH_MIST) return "mistake";
  if (cpLoss >= TH_INACC) return "inaccuracy";
  return "ok";
}

function nonPawnNonKingMaterial(fen: string): number {
  // Sum classico dei valori dei pezzi (esclusi pedoni e re).
  const board = fen.split(" ")[0];
  const vals: Record<string, number> = { n: 3, b: 3, r: 5, q: 9, N: 3, B: 3, R: 5, Q: 9 };
  let sum = 0;
  for (const ch of board) {
    sum += vals[ch] ?? 0;
  }
  return sum;
}

function determinePhase(fen: string, fullMoveNumber: number): Phase {
  if (fullMoveNumber <= OPENING_UNTIL_MOVE) return "opening";
  if (nonPawnNonKingMaterial(fen) <= ENDGAME_MATERIAL_THRESHOLD) return "endgame";
  return "middlegame";
}

/** Valore pezzi per il rilevamento hang (esclusi pedoni e re). */
const PIECE_VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/**
 * detectHungPiece — CONSERVATIVO.
 *
 * fenAfter = posizione DOPO la mossa del player → tocca all'avversario.
 * Restituisce true solo se l'avversario può catturare un pezzo >= minore (n/b/r/q)
 * del player senza che quest'ultimo possa ricatturare su quella casa.
 * "Hang pulito": nessuna risposta di ricattura disponibile.
 */
function detectHungPiece(fenAfter: string): boolean {
  let c: Chess;
  try { c = new Chess(fenAfter); } catch { return false; }
  const oppCaptures = c.moves({ verbose: true }).filter((m: any) => m.captured);
  for (const cap of oppCaptures) {
    const capturedPiece = (cap as any).captured as string | undefined;
    const val = capturedPiece ? (PIECE_VAL[capturedPiece] ?? 0) : 0;
    if (val < 3) continue; // solo minore o superiore (no pedoni)
    // Simula la cattura e verifica se il player può ricatturare su quella casa.
    let c2: Chess;
    try { c2 = new Chess(fenAfter); } catch { continue; }
    try { c2.move({ from: cap.from, to: cap.to, promotion: "q" }); } catch { continue; }
    const recaptures = c2.moves({ verbose: true }).filter((m: any) => m.to === cap.to && m.captured);
    if (recaptures.length === 0) return true; // hang pulito
  }
  return false;
}

// ── Transfer motif detection (§7.2 BUILD.md) ─────────────────────────────────
//
// HEURISTIC: all classifications use chess.js geometry only — no deep engine
// look-ahead beyond what Stockfish already gave us (bestMoveUci). This means:
//   - "hanging_piece" may miss defended-but-en-prise captures (SEE needed for
//     precision), and may misclassify exchange sacrifices. Conservative approach.
//   - "fork" counts double attacks after the best move on pieces of value >= minor
//     or the king. May over-count in positions with multiple threats already present.
//   - "back_rank" checks only static geometry (rank 1/8 weakness + queen/rook line)
//     — it won't see multi-move back-rank combinations.
// All of this is declared and acceptable: "affrontato {motif}" is approximate.

const HANDLED_CP_THRESHOLD = 50; // cp_loss < 50 → the player handled the situation

/**
 * Returns the piece value (pawn=1, minor=3, rook=5, queen=9) for a piece letter.
 * King is 100 to make it always count as a target.
 */
function pieceValue(piece: string): number {
  const vals: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  return vals[piece.toLowerCase()] ?? 0;
}

/**
 * detectHangingPieceMotif — HEURISTIC.
 *
 * The motif is present when the best move (bestMoveUci) IS a capture that wins
 * material (captured piece value > moving piece value / piece is free) OR when a
 * player piece on the board is attacked and under-defended (attackers > defenders)
 * and the best move saves it.
 *
 * fenBefore: position before the player's move (player to move).
 * bestMoveUci: Stockfish best move UCI (e.g. "e5d6").
 * playerColor: "white" | "black".
 */
function detectHangingPieceMotif(
  fenBefore: string,
  bestMoveUci: string | null,
  playerColor: "white" | "black",
): boolean {
  if (!bestMoveUci || bestMoveUci.length < 4) return false;
  let c: Chess;
  try { c = new Chess(fenBefore); } catch { return false; }

  const fromSq = bestMoveUci.slice(0, 2);
  const toSq   = bestMoveUci.slice(2, 4);

  // --- Heuristic A: best move is a capture that wins material ---
  const targetPiece = c.get(toSq as Parameters<typeof c.get>[0]);
  if (targetPiece && targetPiece.color !== (playerColor === "white" ? "w" : "b")) {
    // There IS an enemy piece on the target square → it's a capture.
    const capVal  = pieceValue(targetPiece.type);
    if (capVal >= 3) {
      // It's at least a minor piece. Check if it's defended: simulate the capture
      // and see if opponent can recapture on the same square.
      let c2: Chess;
      try { c2 = new Chess(fenBefore); } catch { return false; }
      try { c2.move({ from: fromSq, to: toSq, promotion: "q" }); } catch { return false; }
      const recaps = c2.moves({ verbose: true }).filter(
        (m: any) => (m.to as string) === toSq && m.captured
      );
      if (recaps.length === 0) {
        // Piece is free (undefended) — hanging_piece.
        return true;
      }
      // Defended, but check if we gain material (moving piece value < captured piece).
      const movingPiece = c.get(fromSq as Parameters<typeof c.get>[0]);
      if (movingPiece && pieceValue(movingPiece.type) < capVal) {
        return true; // favourable exchange — material gain
      }
    }
  }

  // --- Heuristic B: one of our pieces is attacked and under-defended, and the
  //     best move saves it (best move's from-square is NOT the hanging piece itself
  //     but we check if any of our pieces is hanging right now). ---
  const ourColor = playerColor === "white" ? "w" : "b";
  const oppColor = playerColor === "white" ? "b" : "w";
  const board = c.board();
  for (const row of board) {
    for (const sq of row) {
      if (!sq || sq.color !== ourColor) continue;
      if (sq.type === "k") continue; // king handled separately (check detection)
      const val = pieceValue(sq.type);
      if (val < 3) continue; // only minor pieces and above

      // Count attackers (opponent pieces attacking this square).
      const attackers = c.attackers(sq.square as Parameters<typeof c.attackers>[0], oppColor);
      if (attackers.length === 0) continue;

      // Count defenders (our pieces defending this square, excluding the piece itself).
      const defenders = c.attackers(sq.square as Parameters<typeof c.attackers>[0], ourColor);
      // Under-defended: more attackers than defenders, or completely undefended.
      if (attackers.length > defenders.length) {
        // Our piece is under-defended — hanging_piece motif (save scenario).
        return true;
      }
    }
  }

  return false;
}

/**
 * detectForkMotif — HEURISTIC.
 *
 * After the best move is played, the moved piece attacks 2+ valuable targets
 * (pieces of value >= minor OR the king) simultaneously. This is the canonical
 * double-attack / fork pattern.
 *
 * fenBefore: position before the player's move.
 * bestMoveUci: Stockfish best move UCI.
 * playerColor: "white" | "black".
 */
function detectForkMotif(
  fenBefore: string,
  bestMoveUci: string | null,
  playerColor: "white" | "black",
): boolean {
  if (!bestMoveUci || bestMoveUci.length < 4) return false;

  const fromSq = bestMoveUci.slice(0, 2);
  const toSq   = bestMoveUci.slice(2, 4);

  // Simulate the best move.
  let c2: Chess;
  try { c2 = new Chess(fenBefore); } catch { return false; }
  try { c2.move({ from: fromSq, to: toSq, promotion: "q" }); } catch { return false; }

  // After the move, find what the moved piece (now on toSq) attacks.
  const ourColorChess = playerColor === "white" ? "w" : "b";
  const oppColor = playerColor === "white" ? "b" : "w";
  const board2 = c2.board();
  let valuableTargets = 0;

  for (const row of board2) {
    for (const sq of row) {
      if (!sq || sq.color !== oppColor) continue;
      const val = pieceValue(sq.type);
      if (val < 3 && sq.type !== "k") continue; // only minors+, or king

      // Is this target square attacked by our piece that just moved?
      const attackers = c2.attackers(sq.square as Parameters<typeof c2.attackers>[0], ourColorChess);
      // attackers is Square[] — check if toSq (as Square) is in the list.
      if ((attackers as string[]).includes(toSq)) {
        valuableTargets++;
      }
    }
  }

  return valuableTargets >= 2;
}

/**
 * detectBackRankMotif — HEURISTIC.
 *
 * The best move gives check on the opponent's back rank (rank 1 for black,
 * rank 8 for white), or threatens mate there (queen/rook on the last rank with
 * the king trapped). We detect two cases:
 *   A) The best move directly gives check and lands on the opponent's last rank.
 *   B) The best move places a queen or rook on the opponent's back rank with
 *      the opponent's king also on that rank (back-rank mate threat).
 *
 * fenBefore: position before the player's move.
 * bestMoveUci: Stockfish best move UCI.
 * playerColor: "white" | "black".
 */
function detectBackRankMotif(
  fenBefore: string,
  bestMoveUci: string | null,
  playerColor: "white" | "black",
): boolean {
  if (!bestMoveUci || bestMoveUci.length < 4) return false;
  let c: Chess;
  try { c = new Chess(fenBefore); } catch { return false; }

  const fromSq = bestMoveUci.slice(0, 2);
  const toSq   = bestMoveUci.slice(2, 4);

  // Opponent's back rank: rank 1 for black king, rank 8 for white king.
  const oppBackRank = playerColor === "white" ? "8" : "1";

  // Case A: the destination square is on the opponent's back rank.
  if (toSq[1] === oppBackRank) {
    // Simulate the move and check if it gives check (in check = back-rank attack).
    let c2: Chess;
    try { c2 = new Chess(fenBefore); } catch { return false; }
    try { c2.move({ from: fromSq, to: toSq, promotion: "q" }); } catch { return false; }
    if (c2.inCheck()) return true;
  }

  // Case B: best move places a heavy piece (Q/R) on the opponent's back rank and
  // the opponent's king is also on that rank (trapped → back-rank weakness).
  const movingPiece = c.get(fromSq as Parameters<typeof c.get>[0]);
  if (movingPiece && (movingPiece.type === "q" || movingPiece.type === "r")) {
    if (toSq[1] === oppBackRank) {
      // Check if opponent's king is on their back rank.
      const oppColor = playerColor === "white" ? "b" : "w";
      const board = c.board();
      for (const row of board) {
        for (const sq of row) {
          if (sq && sq.color === oppColor && sq.type === "k") {
            if (sq.square[1] === oppBackRank) return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * classifyOccurrenceMotif — main entry point.
 *
 * Classifies the motif for a critical position given the position's FEN
 * (before the player's move) and the Stockfish best move UCI.
 *
 * HEURISTIC ORDER (first match wins):
 *   1. back_rank   — specific and high-value; checked first.
 *   2. fork        — double attack after best move.
 *   3. hanging_piece — material win / save hanging piece.
 *   4. none        — positional / quiet move, no clear tactic.
 *
 * Returns "none" when bestMoveUci is null (position not evaluated).
 */
function classifyOccurrenceMotif(
  fenBefore: string,
  bestMoveUci: string | null,
  playerColor: "white" | "black",
): TransferMotifType {
  if (!bestMoveUci) return "none";
  if (detectBackRankMotif(fenBefore, bestMoveUci, playerColor)) return "back_rank";
  if (detectForkMotif(fenBefore, bestMoveUci, playerColor)) return "fork";
  if (detectHangingPieceMotif(fenBefore, bestMoveUci, playerColor)) return "hanging_piece";
  return "none";
}

/**
 * Parsa l'header "TimeControl" del PGN.
 * Formati: "600", "180+2", "1/259200" (daily), "-" (nessuno).
 * Restituisce { base, increment } in secondi, o null per daily/assente.
 *
 * increment = bonus aggiunto al clock del giocatore DOPO che ha mosso.
 * Necessario per calcolare correttamente il tempo speso (vedi spentSeconds).
 */
const parseTimeControl = parseClockControl;

/**
 * Calcola stateBefore a partire dallo scoreBeforeCp.
 */
function computeStateBefore(scoreBeforeCp: number): StateBefore {
  if (scoreBeforeCp >= 150) return "winning";
  if (scoreBeforeCp <= -150) return "losing";
  return "equalish";
}

/**
 * Calcola timeState per una mossa del player.
 * null se non c'è clock o baseSeconds è null (daily/assente).
 */
function computeTimeState(
  clockRemaining: number | null,
  spentSeconds: number | null,
  baseSeconds: number | null
): TimeState | null {
  if (baseSeconds === null || clockRemaining === null) return null;
  const lowClock = Math.max(10, Math.min(60, 0.10 * baseSeconds));
  const isBullet = baseSeconds <= 120;
  if (clockRemaining <= lowClock) return "zeitnot";
  if (isBullet) return "normal";
  if (spentSeconds !== null && spentSeconds <= 3) return "rushed";
  if (spentSeconds !== null && spentSeconds >= Math.max(20, 0.08 * baseSeconds)) return "long_think";
  return "normal";
}

/**
 * Scala l'eval di Stockfish (sempre dal punto di vista del side-to-move post
 * `position fen`) al punto di vista del PLAYER specifico.
 *
 * `playerColor`: il colore del nostro utente.
 * `sideToMoveAtFen`: chi è al tratto in `fen`.
 *
 * Stockfish ritorna scoreCp dal pov di sideToMove. Se sideToMove = playerColor,
 * lo score è già "nostro". Altrimenti, va negato.
 */
function scoreFromPlayerPov(
  scoreCp: number | null,
  mate: number | null,
  sideToMoveAtFen: "w" | "b",
  playerColor: "white" | "black"
): number {
  let s: number;
  if (mate !== null) s = mate > 0 ? 10000 : -10000;
  else s = scoreCp ?? 0;
  const matches = (sideToMoveAtFen === "w" && playerColor === "white") ||
                  (sideToMoveAtFen === "b" && playerColor === "black");
  return matches ? s : -s;
}

export async function analyzeGame(
  game: GameRow,
  engine: StockfishEngine,
  onMoveProgress?: (movesDone: number, movesTotal: number) => void,
  pulseLease?: () => Promise<void>,
): Promise<GameAnalysis | null> {
  await pulseLease?.();
  const pgn = await downloadText(game.pgn_path);
  await pulseLease?.();
  if (!pgn) {
    // eslint-disable-next-line no-console
    console.warn("[analyze] PGN mancante per", game.chess_com_uuid);
    return null;
  }
  return analyzePgn(game, pgn, engine, onMoveProgress, pulseLease);
}

/** Shared analysis core: the storage adapter above and offline corpus checks
 * run the same chess, timing and opportunity extraction. */
export async function analyzePgn(
  game: GameRow,
  pgn: string,
  engine: StockfishEngine,
  onMoveProgress?: (movesDone: number, movesTotal: number) => void,
  pulseLease?: () => Promise<void>,
): Promise<GameAnalysis | null> {
  await pulseLease?.();
  const { sanList, headers, clocks } = extractMoves(pgn);
  if (sanList.length === 0) return null;

  // Eco/Opening dagli header PGN.
  const ecoTag: string | null = headers["ECO"] ?? headers["ECOUrl"] ?? null;
  // Chess.com encodes the opening NAME in the ECOUrl slug (not in [Opening]),
  // e.g. ".../openings/Vienna-Game-Falkbeer-Variation". Derive the name from it
  // so the Repertoire shows real names instead of "Unknown".
  const ecoUrl: string | null = headers["ECOUrl"] ?? null;
  const openingFromUrl: string | null = ecoUrl
    ? (decodeURIComponent(ecoUrl.split("/").pop() ?? "").replace(/-/g, " ").trim() || null)
    : null;
  const openingTag: string | null = headers["Opening"] ?? openingFromUrl ?? null;

  // Chess.com PGN carries the canonical game URL in the [Link] header.
  const gameUrl: string | null = headers["Link"] ?? null;

  // Time control: null per daily/assente.
  const timeControlRaw: string | null = headers["TimeControl"] ?? null;
  const parsedTc = parseTimeControl(timeControlRaw);
  const timeControlBaseSeconds: number | null = parsedTc?.base ?? null;
  // increment in seconds: added to the player's clock AFTER they make a move.
  const timeControlIncrement: number = parsedTc?.increment ?? 0;

  const playerColor = game.color;
  await engine.waitReady();

  // Itera le mosse: valuto SOLO le mosse del player.
  const chess = new Chess();
  const analyzed: AnalyzedMove[] = [];

  let totalCpLoss = 0;
  let totalPlayerMoves = 0;
  const byPhase: Record<Phase, { moves: number; blunders: number; mistakes: number; inaccuracies: number; cpLossSum: number }> = {
    opening: { moves: 0, blunders: 0, mistakes: 0, inaccuracies: 0, cpLossSum: 0 },
    middlegame: { moves: 0, blunders: 0, mistakes: 0, inaccuracies: 0, cpLossSum: 0 },
    endgame: { moves: 0, blunders: 0, mistakes: 0, inaccuracies: 0, cpLossSum: 0 },
  };

  // Transfer: motif occurrences for every analyzed player position (§7.2).
  const motifOccurrences: MotifOccurrence[] = [];

  const playerSide: "w" | "b" = playerColor === "white" ? "w" : "b";

  // Traccia l'ultima mossa applicata (player o avversario) per estrarre
  // la mossa avversaria immediatamente precedente a quella del player.
  let lastApplied: { from: string; to: string; san: string } | null = null;

  for (let i = 0; i < sanList.length; i++) {
    const san = sanList[i];
    const fenBefore = chess.fen();
    const sideToMove = fenBefore.split(" ")[1] as "w" | "b";
    const isPlayerMove = sideToMove === playerSide;
    const legalMoveCount = isPlayerMove ? chess.moves().length : 0;

    let mv: { from: string; to: string; san: string; lan: string } | null = null;
    try {
      mv = chess.move(san) as unknown as { from: string; to: string; san: string; lan: string };
    } catch {
      break;
    }
    if (!mv) break;

    // Mossa avversario: aggiorna lastApplied e passa alla prossima iterazione.
    if (!isPlayerMove) {
      lastApplied = { from: mv.from, to: mv.to, san: mv.san };
      continue;
    }

    // Mossa player: lastApplied (se presente) è la mossa avversaria precedente.
    const oppBeforeThis = lastApplied;

    const fenAfter = chess.fen();
    const fullMoveNumber = parseInt(fenBefore.split(" ")[5] ?? "1", 10);
    const phase = determinePhase(fenBefore, fullMoveNumber);

    // A game can take minutes on a slow device. Fence every Stockfish eval so
    // lease loss terminates this lane instead of overlapping a takeover worker.
    await pulseLease?.();
    const evalBefore = await engine.evaluate(fenBefore, DEPTH);
    await pulseLease?.();
    const evalAfter = await engine.evaluate(fenAfter, DEPTH);
    await pulseLease?.();

    const sideToMoveAfter = (fenAfter.split(" ")[1] as "w" | "b");

    const scoreBefore = scoreFromPlayerPov(
      evalBefore.scoreCp,
      evalBefore.mate,
      sideToMove,
      playerColor
    );
    const scoreAfter = scoreFromPlayerPov(
      evalAfter.scoreCp,
      evalAfter.mate,
      sideToMoveAfter,
      playerColor
    );

    // Cap a 1000cp: uno swing da/verso matto (±10000) altrimenti domina le medie.
    const cpLoss = Math.min(1000, Math.max(0, scoreBefore - scoreAfter));
    const category = classify(cpLoss);
    const acceptableObservedMoveUcis = acceptableObservedMovesFromEvaluation(evalBefore);
    const isCritical = isCriticalPosition(i + 1, scoreBefore);

    // Motif v1 conservativo: etichetta solo mistake/blunder con hang pulito.
    const motif: string | null =
      (category === "mistake" || category === "blunder") && detectHungPiece(fenAfter)
        ? "pezzo_in_presa"
        : null;

    // stockfishChoiceGap: gap fra linea 1 e linea 2 dal pov del player.
    // evalBefore è sul FEN dove tocca al player → Stockfish score = POV player.
    let stockfishChoiceGap: number | null = null;
    {
      const lines = evalBefore.lines;
      if (
        lines.length >= 2 &&
        lines[0].mate === null &&
        lines[1].mate === null &&
        lines[0].scoreCp !== null &&
        lines[1].scoreCp !== null
      ) {
        const gap = lines[0].scoreCp - lines[1].scoreCp;
        stockfishChoiceGap = Math.min(1, Math.max(0, gap / 200));
      }
      // else: null (mate present or < 2 lines)
    }

    // spentSeconds: how long the player thought on move i.
    //
    // Chess.com clock model:
    //   clock[i] = time REMAINING after move i, ALREADY INCLUDING the increment
    //              the player earned for making that move.
    //
    // So for move i (index 0-based), the player's clock at the START of their turn
    // was clock[i-2] (their clock after their previous move, same colour), oppure
    // il tempo base per la prima mossa di quel colore.
    // When they move, they get `timeControlIncrement` added, then their elapsed
    // time is subtracted, leaving clock[i].
    //
    // Therefore:
    //   spentSeconds = clockPrev + increment - clockAfter
    //   = (clock[i-2] oppure base) + timeControlIncrement - clock[i]
    //
    // This is clamped to >= 0 within a small rounding tolerance.
    // null when either clock is missing (no [%clk] annotations, or daily).
    const clockRemaining: number | null = clocks.length > 0 ? (clocks[i] ?? null) : null;
    const spentSeconds = computeSpentSeconds(
      i,
      clocks,
      timeControlBaseSeconds,
      timeControlIncrement,
    );

    // Campi derivati A3.
    const stateBefore = computeStateBefore(scoreBefore);
    const timeState = computeTimeState(clockRemaining, spentSeconds, timeControlBaseSeconds);
    const errClass = classifyErrorSemantics({
      cpLoss,
      scoreBeforeCp: scoreBefore,
      scoreAfterCp: scoreAfter,
      timeState,
      motif,
      stockfishChoiceGap,
      spentSeconds,
      clockRemaining,
      timeControlBaseSeconds,
    });
    const opportunityMotif = classifyOccurrenceMotif(fenBefore, evalBefore.bestMoveUci, playerColor);

    analyzed.push({
      ply: i + 1,
      san: mv.san,
      uci: mv.lan,
      fenBefore,
      fenAfter,
      scoreBeforeCp: scoreBefore,
      scoreAfterCp: scoreAfter,
      cpLoss,
      category,
      phase,
      bestMoveUci: evalBefore.bestMoveUci,
      acceptableObservedMoveUcis,
      acceptableSetMultiPv: evalBefore.lines.length,
      acceptableMovesComplete: false,
      isCritical,
      spentSeconds,
      clockRemaining,
      clockBeforeSeconds: i >= 2 ? (clocks[i - 2] ?? null) : timeControlBaseSeconds,
      legalMoveCount,
      opportunityMotif,
      motif,
      moveDifficulty: stockfishChoiceGap,
      stockfishChoiceGap,
      last_opp_from: oppBeforeThis?.from ?? null,
      last_opp_to: oppBeforeThis?.to ?? null,
      last_opp_san: oppBeforeThis?.san ?? null,
      // Contesto pre-errore: le 4 mosse precedenti, entrambi i colori, in
      // ordine cronologico. Solo per blunder/mistake: sono le sole che possono
      // arrivare alla Sessione, e sono le sole dove il contesto serve.
      prevMoves: sanList.slice(Math.max(0, i - PREV_MOVES_CONTEXT), i),
      stateBefore,
      timeState,
      errorType: errClass?.primary_category ?? null,
      errorSignals: errClass?.signals ?? [],
      errorEvidence: errClass?.evidence ?? null,
      legacyErrorType: errClass?.legacy_error_type ?? null,
      trainabilityWeight: errClass?.trainability_weight ?? null,
      blameWeight: errClass?.trainability_weight ?? null,
      impact: errClass?.impact ?? null,
    });

    // Aggiorna lastApplied con la mossa del player appena analizzata.
    lastApplied = { from: mv.from, to: mv.to, san: mv.san };

    // ── Transfer: occurrence detection for this position (§7.2 BUILD.md) ──────
    // Classify the motif of the BEST MOVE (not the played move) heuristically.
    // Register for ALL analyzed positions (not only errors).
    {
      motifOccurrences.push({
        motif: opportunityMotif,
        handled: cpLoss < HANDLED_CP_THRESHOLD,
        played_at: game.played_at,
        phase,
      });
    }

    totalCpLoss += cpLoss;
    totalPlayerMoves++;
    const p = byPhase[phase];
    p.moves++;
    p.cpLossSum += cpLoss;
    if (category === "blunder") p.blunders++;
    else if (category === "mistake") p.mistakes++;
    else if (category === "inaccuracy") p.inaccuracies++;

    onMoveProgress?.(totalPlayerMoves, Math.ceil(sanList.length / 2));
  }

  const summary: GameAnalysis = {
    game_id: game.id,
    chess_com_uuid: game.chess_com_uuid,
    played_at: game.played_at,
    color: playerColor,
    result: game.result,
    time_class: game.time_class,
    total_player_moves: totalPlayerMoves,
    blunders: analyzed.filter((m) => m.category === "blunder").length,
    mistakes: analyzed.filter((m) => m.category === "mistake").length,
    inaccuracies: analyzed.filter((m) => m.category === "inaccuracy").length,
    avg_cp_loss: totalPlayerMoves > 0 ? totalCpLoss / totalPlayerMoves : 0,
    eco: ecoTag,
    game_url: gameUrl,
    opening: openingTag,
    time_control_base_seconds: timeControlBaseSeconds,
    time_control_increment_seconds: parsedTc?.increment ?? null,
    by_phase: {
      opening: {
        moves: byPhase.opening.moves,
        blunders: byPhase.opening.blunders,
        mistakes: byPhase.opening.mistakes,
        inaccuracies: byPhase.opening.inaccuracies,
        avg_cp_loss:
          byPhase.opening.moves > 0
            ? byPhase.opening.cpLossSum / byPhase.opening.moves
            : 0,
      },
      middlegame: {
        moves: byPhase.middlegame.moves,
        blunders: byPhase.middlegame.blunders,
        mistakes: byPhase.middlegame.mistakes,
        inaccuracies: byPhase.middlegame.inaccuracies,
        avg_cp_loss:
          byPhase.middlegame.moves > 0
            ? byPhase.middlegame.cpLossSum / byPhase.middlegame.moves
            : 0,
      },
      endgame: {
        moves: byPhase.endgame.moves,
        blunders: byPhase.endgame.blunders,
        mistakes: byPhase.endgame.mistakes,
        inaccuracies: byPhase.endgame.inaccuracies,
        avg_cp_loss:
          byPhase.endgame.moves > 0 ? byPhase.endgame.cpLossSum / byPhase.endgame.moves : 0,
      },
    },
    moves: analyzed,
    motif_occurrences: motifOccurrences,
  };

  return summary;
}

export interface AnalyzeRunResult extends AnalysisProgressCounts {
  /** Successi appartenenti alla fetta richiesta, non all'intera quota. */
  sliceSucceeded: number;
}

export async function runAnalyze(opts: {
  userId: string;
  jobId: string;
  leaseToken: string;
  guardLease: () => Promise<void>;
  pulseLease: () => Promise<void>;
  /** La quota e le due fette appartengono alla stessa cadenza scelta. */
  goalTimeClass: AnalyzedTimeClass;
  onProgress?: (progress: AnalysisProgressCounts) => void;
  /**
   * Se presente, lavora solo su una fetta della quota ordinata per recenza.
   * `offset` e `limit` si applicano DOPO aver costruito la quota completa
   * (FREE_GAME_CAP partite più recenti, ordinate DESC). Il passaggio di fondo
   * può includere di nuovo 0..100: salta i successi e ritenta gli errori.
   *
   * Il progress emesso è ASSOLUTO (0..total dell'intera quota), non relativo
   * alla fetta: così rimane monotono attraverso le due chiamate successive.
   * `processed` include i tentativi; `succeeded` solo i JSON persistiti come done.
   * `total` = dimensione dell'intera quota (non della fetta).
   */
  range?: { offset: number; limit: number };
}): Promise<AnalyzeRunResult> {
  const {
    userId,
    jobId,
    leaseToken,
    guardLease,
    pulseLease,
    goalTimeClass,
    onProgress,
    range,
  } = opts;

  // Quota free = le FREE_GAME_CAP partite PIÙ RECENTI della goal_time_class.
  // È stabile: resume/retry ri-puntano alla stessa cadenza e non mescolano
  // rapid e blitz nello stesso profilo analitico.
  await guardLease();
  const { data: recentGames, error: recentGamesError } = await supabase
    .from("games")
    .select("*")
    .eq("user_id", userId)
    .eq("time_class", goalTimeClass)
    .order("played_at", { ascending: false })
    .limit(FREE_GAME_CAP);
  await guardLease();

  const quota = requireAnalysisRows(recentGames, recentGamesError);
  // total è sempre la dimensione TOTALE della quota (non della fetta), così
  // il progress è monotono 0→total attraverso le due chiamate.
  const total = quota.length;

  // Fetta di lavoro: se range è presente, operiamo su quota[offset..offset+limit].
  const slice = range ? quota.slice(range.offset, range.offset + range.limit) : quota;

  // done_base: partite già 'done' FUORI dalla fetta corrente (per monotonia).
  // Se non c'è range (run completo), done_base = 0 e contiamo tutto in slice.
  const doneOutsideSlice = range
    ? quota.filter((g, idx) => idx < range.offset && isPersistedAnalysisSuccess(g)).length +
      quota.filter(
        (g, idx) =>
          idx >= range.offset + range.limit && isPersistedAnalysisSuccess(g)
      ).length
    : 0;

  const toDo = analysisWorkItems(quota, range);
  let progress: AnalysisProgressCounts = {
    processed: doneOutsideSlice + (slice.length - toDo.length),
    total,
    succeeded: quota.filter(isPersistedAnalysisSuccess).length,
  };
  let sliceSucceeded = slice.filter(isPersistedAnalysisSuccess).length;
  onProgress?.(progress);

  if (toDo.length === 0) {
    await persistAnalyzeProgress(jobId, leaseToken, progress.processed, true);
    return { ...progress, sliceSucceeded };
  }

  // Spin up a pool of N workers (at most 4, leaving 1 core for the main thread).
  const N = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  await guardLease();
  const pool = createStockfishPool(N);
  try {
    await Promise.all(pool.map((e) => e.waitReady()));

  // Round-robin across N lanes: lane laneIdx processes games at indices laneIdx, laneIdx+N, …
  await Promise.all(
    pool.map((engine, laneIdx) =>
      (async () => {
        for (let i = laneIdx; i < toDo.length; i += N) {
          const g = toDo[i];
          let analyzedSuccessfully = false;
          try {
            await guardLease();
            await updateGameRequired(
              g.id,
              { analysis_status: "analyzing", error: null },
              "analysis_status_start_failed",
            );

            const summary = await analyzeGame(g, engine, undefined, pulseLease);
            if (!summary) throw new Error("no_pgn_or_empty");
            await guardLease();

            const path = analysisPath(userId, g.chess_com_uuid);
            await uploadJson(path, summary);
            await guardLease();
            await updateGameRequired(
              g.id,
              { analysis_status: "done", analysis_path: path, error: null },
              "analysis_status_done_failed",
            );
            await guardLease();
            analyzedSuccessfully = true;
          } catch (e) {
            if (e instanceof LeaseOwnershipLostError) throw e;
            // Fence the error write too: an expired worker must not overwrite a
            // successful result persisted by the tab that took the lease over.
            await guardLease();
            const { data: errorRow, error: errorPersistError } = await supabase
              .from("games")
              .update({
                analysis_status: "error",
                error: String(e instanceof Error ? e.message : e),
              })
              .eq("id", g.id)
              .select("id")
              .maybeSingle();
            if (errorPersistError || !errorRow) {
              // eslint-disable-next-line no-console
              console.warn("[analyze] failed to persist game error state");
            }
            await guardLease();
          }
          // JS is single-threaded: no real race on these counters.
          progress = advanceAnalysisProgress(progress, analyzedSuccessfully);
          if (analyzedSuccessfully) sliceSucceeded++;
          onProgress?.(progress);
          if (progress.processed % 3 === 0) {
            await persistAnalyzeProgress(jobId, leaseToken, progress.processed, false);
          }
        }
      })()
    )
  );

  await persistAnalyzeProgress(jobId, leaseToken, progress.processed, true);
  await guardLease();
    return { ...progress, sliceSucceeded };
  } finally {
    pool.forEach((engine) => engine.destroy());
  }
}
