/**
 * moveReason.ts — "Frase vera dalla posizione" (board-aware deterministico).
 *
 * Regola d'oro: emetti SOLO fatti scacchistici derivabili dalla scacchiera.
 * Se non c'e' un fatto chiaro e vero, ritorna null.
 * Una frase falsa e' peggio del silenzio.
 *
 * Zero LLM, zero magic. Solo chess.js + valori pezzo + logica di forchetta.
 */

import { Chess } from "chess.js";
import { tr, getLang } from "../i18n/lang";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface MoveReasonInput {
  fenBefore: string;
  myColor: "white" | "black";
  /** Mossa giocata (SAN o null se non disponibile). */
  playedSan?: string | null;
  /** Mossa giocata in formato UCI. */
  playedUci?: string | null;
  /** Mossa migliore (UCI). */
  bestUci?: string | null;
  /** Mossa migliore (SAN). */
  bestSan?: string | null;
  motif?: string | null;
  phase?: string | null;
  lastOppSan?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Piece value table (centipawns)
// ────────────────────────────────────────────────────────────────────────────

const PIECE_VALUES: Record<string, number> = {
  p: 100,   // pedone
  n: 300,   // cavallo
  b: 300,   // alfiere
  r: 500,   // torre
  q: 900,   // donna
  k: 20000, // re (non catturabile, usato per forchetta)
};

// ────────────────────────────────────────────────────────────────────────────
// Piece name localization
// Called at render time so getLang() always reads the current language.
// ────────────────────────────────────────────────────────────────────────────

function pieceName(pieceType: string): string {
  const lang = getLang();
  const names: Record<string, { it: string; en: string }> = {
    p: { it: "pedone",  en: "pawn"   },
    n: { it: "cavallo", en: "knight" },
    b: { it: "alfiere", en: "bishop" },
    r: { it: "torre",   en: "rook"   },
    q: { it: "donna",   en: "queen"  },
    k: { it: "re",      en: "king"   },
  };
  const entry = names[pieceType.toLowerCase()];
  if (!entry) return pieceType;
  return lang === "en" ? entry.en : entry.it;
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: resolve a move to SAN (tries SAN first, then UCI)
// ────────────────────────────────────────────────────────────────────────────

function resolveMove(
  fen: string,
  san?: string | null,
  uci?: string | null,
): string | null {
  try {
    if (san) {
      const c = new Chess(fen);
      const mv = c.move(san, { strict: false } as never);
      return mv ? mv.san : null;
    }
    if (uci && uci.length >= 4) {
      const c = new Chess(fen);
      const mv = c.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
      });
      return mv ? (mv as unknown as { san: string }).san : null;
    }
  } catch {
    // FEN or move parse failure
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: build a FEN with the given side to move (flips the turn field)
// Resets en passant to "-" to avoid illegal FEN after the flip.
// ────────────────────────────────────────────────────────────────────────────

function fenWithTurn(fen: string, color: "w" | "b"): string {
  const parts = fen.split(" ");
  parts[1] = color;
  parts[3] = "-"; // reset en passant (may not be valid after turn flip)
  return parts.join(" ");
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: find the cheapest enemy capture of a friendly piece on `square`.
//
// Returns { san, capturer_type } of the cheapest attacker move, or null if
// no enemy legal capture lands on that square.
//
// `fen` must have the ENEMY to move (or will be normalised internally).
// Exported so extractMoveFacts can reuse it without re-running isEnPrise.
// ────────────────────────────────────────────────────────────────────────────

export interface CheapestCapture {
  san: string;
  capturer_type: string;
  victim_square: string;
}

export function cheapestCaptureOf(
  fenAfterMyMove: string,
  square: string,
  myColor: "w" | "b",
): CheapestCapture | null {
  try {
    const enemyColor: "w" | "b" = myColor === "w" ? "b" : "w";
    const enemyFen = fenWithTurn(fenAfterMyMove, enemyColor);
    const chess = new Chess(enemyFen);

    const victim = chess.get(square as never);
    if (!victim || victim.color !== myColor) return null;

    const caps = chess
      .moves({ verbose: true })
      .filter((m) => m.to === square && m.captured);
    if (caps.length === 0) return null;

    let cheapestMove: { san: string; from: string; to: string; promotion?: string } | null = null;
    let cheapestVal = Infinity;
    for (const m of caps) {
      const att = chess.get(m.from as never);
      const v = att ? PIECE_VALUES[att.type] ?? 100 : 100;
      if (v < cheapestVal) {
        cheapestVal = v;
        cheapestMove = { san: m.san, from: m.from, to: m.to, promotion: m.promotion };
      }
    }
    if (!cheapestMove) return null;

    // Resolve attacker type
    const chess2 = new Chess(enemyFen);
    const att2 = chess2.get(cheapestMove.from as never);
    const capturerType = att2 ? att2.type : "p";

    return { san: cheapestMove.san, capturer_type: capturerType, victim_square: square };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: is the friendly piece on `square` genuinely en prise?
//
// chess.js v1-beta has no .attackers(), and counting "defenders" by listing
// friendly capture-moves onto an OCCUPIED friendly square always returns 0
// (you cannot capture your own piece). So instead we run a lightweight
// 1-exchange check: let the enemy play its CHEAPEST capture of the piece,
// then check whether we can recapture on that square.
//   - no recapture            => lost for nothing            => en prise
//   - recapture, losing trade => cheaper attacker than victim => en prise
//   - recapture, even/better trade                           => NOT en prise
//
// `fen` is the position right after my move (enemy to move); the turn is
// normalised to the enemy regardless.
// ────────────────────────────────────────────────────────────────────────────

function isEnPrise(
  fen: string,
  square: string,
  myColor: "w" | "b",
): boolean {
  try {
    const enemyColor: "w" | "b" = myColor === "w" ? "b" : "w";
    const enemyFen = fenWithTurn(fen, enemyColor);
    const chess = new Chess(enemyFen);

    const victim = chess.get(square as never);
    if (!victim || victim.color !== myColor) return false;
    const victimValue = PIECE_VALUES[victim.type] ?? 100;

    const caps = chess
      .moves({ verbose: true })
      .filter((m) => m.to === square && m.captured);
    if (caps.length === 0) return false;

    // Cheapest attacker (by the value of the capturing piece).
    let cheapest: { from: string; to: string; promotion?: string } | null = null;
    let cheapestVal = Infinity;
    for (const m of caps) {
      const att = chess.get(m.from as never);
      const v = att ? PIECE_VALUES[att.type] ?? 100 : 100;
      if (v < cheapestVal) {
        cheapestVal = v;
        cheapest = { from: m.from, to: m.to, promotion: m.promotion };
      }
    }
    if (!cheapest) return false;
    // If even the cheapest attacker is worth more than the victim, the enemy
    // gains nothing by capturing — not en prise.
    if (cheapestVal > victimValue) return false;

    // Simulate the cheapest capture, then look for a recapture on `square`.
    const after = new Chess(enemyFen);
    after.move({ from: cheapest.from, to: cheapest.to, promotion: cheapest.promotion });
    const recaps = after
      .moves({ verbose: true })
      .filter((m) => m.to === square && m.captured);
    if (recaps.length === 0) return true; // lost for nothing
    // 1-exchange check (capture + single recapture), not a full SEE. Sound for
    // the core claim: when cheapestVal < victimValue with a legal capture, the
    // enemy profits no matter the recapture. The rare miss is a discovered
    // attack that wins the material back; there a quiet claim is acceptable.
    return cheapestVal < victimValue;     // losing trade => still en prise
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: find the most valuable friendly piece left en prise after my move.
// Returns the single most valuable such piece, or null.
// ────────────────────────────────────────────────────────────────────────────

interface HangingPiece {
  square: string;
  type: string;
  value: number;
}

function findHangingPiece(
  fenAfterPlayedMove: string,
  myColor: "w" | "b",
): HangingPiece | null {
  try {
    const chess = new Chess(fenAfterPlayedMove);

    // Collect all friendly pieces (kings excluded — never "en prise").
    const board = chess.board();
    const friendly: HangingPiece[] = [];

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const cell = board[row][col];
        if (cell && cell.color === myColor && cell.type !== "k") {
          const file = String.fromCharCode(97 + col);        // a–h
          const rank = String.fromCharCode(49 + (7 - row));  // 1–8 (board[0] = rank 8)
          const square = file + rank;
          friendly.push({ square, type: cell.type, value: PIECE_VALUES[cell.type] ?? 100 });
        }
      }
    }

    // Most valuable first, so the worst loss is the one we name.
    friendly.sort((a, b) => b.value - a.value);

    for (const fp of friendly) {
      if (isEnPrise(fenAfterPlayedMove, fp.square, myColor)) return fp;
    }

    return null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: what does the best move achieve?
// ────────────────────────────────────────────────────────────────────────────

interface BestMoveEffect {
  isCheckmate: boolean;
  isCheck: boolean;
  isCapture: boolean;
  capturedType: string | null;
  savesPiece: boolean;
  createsFork: boolean;
  bestSanResolved: string | null;
  bestMovedPieceType: string | null;
}

function analyzeBestMove(
  fenBefore: string,
  bestUci: string | null,
  bestSan: string | null,
  myColor: "w" | "b",
  hangingPiece: HangingPiece | null,
): BestMoveEffect {
  const empty: BestMoveEffect = {
    isCheckmate: false,
    isCheck: false,
    isCapture: false,
    capturedType: null,
    savesPiece: false,
    createsFork: false,
    bestSanResolved: null,
    bestMovedPieceType: null,
  };

  if (!bestUci && !bestSan) return empty;

  try {
    const chess = new Chess(fenBefore);

    // Apply best move
    let mv: {
      san: string;
      from: string;
      to: string;
      captured?: string;
      flags: string;
    } | null = null;

    if (bestSan) {
      mv = chess.move(bestSan, { strict: false } as never) as unknown as typeof mv;
    }
    if (!mv && bestUci && bestUci.length >= 4) {
      const c2 = new Chess(fenBefore);
      mv = c2.move({
        from: bestUci.slice(0, 2),
        to: bestUci.slice(2, 4),
        promotion: bestUci.length > 4 ? bestUci.slice(4, 5) : undefined,
      }) as unknown as typeof mv;
      if (mv) {
        const fenAfterBest = c2.fen();
        return buildEffect(empty, mv, fenAfterBest, fenBefore, myColor, hangingPiece);
      }
    }
    if (!mv) return empty;

    return buildEffect(empty, mv, chess.fen(), fenBefore, myColor, hangingPiece);
  } catch {
    return empty;
  }
}

function buildEffect(
  result: BestMoveEffect,
  mv: { san: string; from: string; to: string; captured?: string; flags: string },
  fenAfterBest: string,
  fenBefore: string,
  myColor: "w" | "b",
  hangingPiece: HangingPiece | null,
): BestMoveEffect {
  result.bestSanResolved = mv.san;

  // Piece that moved
  try {
    const before = new Chess(fenBefore);
    const piece = before.get(mv.from as never);
    if (piece) result.bestMovedPieceType = piece.type;
  } catch { /* ignore */ }

  result.isCheckmate = mv.san.includes("#");
  result.isCheck = mv.san.includes("+") || result.isCheckmate;
  result.isCapture = !!mv.captured;
  result.capturedType = mv.captured ?? null;

  // Does best move save the hanging piece?
  if (hangingPiece) {
    try {
      if (mv.from === hangingPiece.square) {
        // The hanging piece itself moved away to safety.
        result.savesPiece = true;
      } else {
        const afterBest = new Chess(fenAfterBest);
        const still = afterBest.get(hangingPiece.square as never);
        if (
          still &&
          still.color === myColor &&
          !isEnPrise(fenAfterBest, hangingPiece.square, myColor)
        ) {
          // Still on its square and no longer en prise (best move defended it
          // or removed the attacker).
          result.savesPiece = true;
        }
      }
    } catch { /* ignore */ }
  }

  // Does best move create a fork?
  // Skip on checking moves: flipping the turn would yield an illegal position
  // (enemy king in check, our turn) and corrupt the read. A check falls
  // through to the always-true "dava scacco" branch instead.
  if (result.bestMovedPieceType && mv.to && !result.isCheck) {
    try {
      const afterBest = new Chess(fenAfterBest);
      const enemyColor: "w" | "b" = myColor === "w" ? "b" : "w";

      // Simulate my turn to find what the moved piece can now capture
      const myTurn = new Chess(fenWithTurn(fenAfterBest, myColor));
      const movesFromTo = myTurn.moves({ verbose: true }).filter(
        (m) => m.from === mv.to && m.captured,
      );

      const threatened = new Map<string, string>(); // square -> pieceType
      for (const m of movesFromTo) {
        const ep = afterBest.get(m.to as never);
        if (ep && ep.color === enemyColor) {
          threatened.set(m.to, ep.type);
        }
      }

      if (threatened.size >= 2) {
        const movedValue = PIECE_VALUES[result.bestMovedPieceType] ?? 100;
        const values = Array.from(threatened.values())
          .map((t) => PIECE_VALUES[t] ?? 100)
          .sort((a, b) => b - a);
        // Sound winning fork only: the enemy can save just the most valuable
        // target, so we are guaranteed to win the SECOND one. Claim it only when
        // that second capture wins material outright (worth more than the piece
        // we moved). This drops "attacks two pieces" when both are merely even
        // trades — better silent than implying a win that is not there.
        if (values[1] > movedValue) {
          result.createsFork = true;
        }
      }
    } catch { /* ignore */ }
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// buildMoveReason — main export
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a Nonno-voice explanation for why the played move was wrong
 * and/or what the best move achieves.
 *
 * Returns a localized string or null if no clear chess fact can be stated.
 * Reads getLang() at call time — never frozen at module load.
 */
export function buildMoveReason(input: MoveReasonInput): string | null {
  try {
    const { fenBefore, myColor, playedSan, playedUci, bestUci, bestSan } = input;
    if (!fenBefore) return null;

    const myColorChess: "w" | "b" = myColor === "white" ? "w" : "b";

    // ── Resolve played move ───────────────────────────────────────────────
    const resolvedPlayedSan = resolveMove(fenBefore, playedSan, playedUci);
    if (!resolvedPlayedSan) return null;

    // ── Apply played move ─────────────────────────────────────────────────
    let fenAfterPlayed: string;
    try {
      const c = new Chess(fenBefore);
      const mv = c.move(resolvedPlayedSan, { strict: false } as never);
      if (!mv) return null;
      fenAfterPlayed = c.fen();
    } catch {
      return null;
    }

    // ── A) Find hanging piece left after played move ───────────────────────
    const hanging = findHangingPiece(fenAfterPlayed, myColorChess);

    // ── B) Analyze best move ───────────────────────────────────────────────
    const bestEffect = analyzeBestMove(
      fenBefore,
      bestUci ?? null,
      bestSan ?? null,
      myColorChess,
      hanging,
    );

    // ── C) Compose phrase ─────────────────────────────────────────────────
    const parts: string[] = [];

    if (hanging) {
      parts.push(
        tr(
          `Il tuo ${pieceName(hanging.type)} in ${hanging.square} era in presa.`,
          `Your ${pieceName(hanging.type)} on ${hanging.square} was there to take.`,
        ),
      );
    }

    if (bestEffect.bestSanResolved) {
      const best = bestEffect.bestSanResolved;

      if (bestEffect.isCheckmate) {
        parts.push(tr(`${best} dava scacco matto.`, `${best} delivers checkmate.`));
      } else if (bestEffect.isCapture && bestEffect.capturedType) {
        const name = pieceName(bestEffect.capturedType);
        if (hanging && bestEffect.savesPiece) {
          parts.push(
            tr(
              `${best} cattura il ${name} e mette al sicuro il tuo pezzo.`,
              `${best} takes the ${name} and keeps your piece safe.`,
            ),
          );
        } else {
          parts.push(tr(`${best} cattura il ${name}.`, `${best} takes the ${name}.`));
        }
      } else if (hanging && bestEffect.savesPiece) {
        parts.push(
          tr(`${best} mette al sicuro il pezzo.`, `${best} keeps the piece safe.`),
        );
      } else if (bestEffect.createsFork && bestEffect.bestMovedPieceType) {
        const movedName = pieceName(bestEffect.bestMovedPieceType);
        parts.push(
          tr(
            `${best}: il ${movedName} attacca due pezzi insieme.`,
            `${best}: the ${movedName} attacks two pieces at once.`,
          ),
        );
      } else if (bestEffect.isCheck) {
        parts.push(tr(`${best} dava scacco.`, `${best} gives check.`));
      }
    }

    // ── D) Gate: only emit if we found at least one concrete fact ─────────
    if (parts.length === 0) return null;

    return parts.join(" ");
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// buildFoundReason — for 'perfect' verdict
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a Nonno-voice confirmation when the player found the best move.
 * Returns null if no specific fact can be added beyond the generic verdict.
 */
export function buildFoundReason(input: MoveReasonInput): string | null {
  try {
    const { fenBefore, myColor, playedSan, playedUci, bestUci, bestSan } = input;
    if (!fenBefore) return null;

    const myColorChess: "w" | "b" = myColor === "white" ? "w" : "b";
    const resolvedPlayed = resolveMove(fenBefore, playedSan, playedUci);
    if (!resolvedPlayed) return null;

    const bestEffect = analyzeBestMove(
      fenBefore,
      bestUci ?? null,
      bestSan ?? null,
      myColorChess,
      null,
    );

    if (bestEffect.isCheckmate) {
      return tr("Hai trovato il matto.", "You found the checkmate.");
    }

    if (bestEffect.isCheck && bestEffect.isCapture && bestEffect.capturedType) {
      const name = pieceName(bestEffect.capturedType);
      return tr(
        `Hai visto la cattura del ${name} con scacco.`,
        `You spotted the ${name} capture with check.`,
      );
    }

    if (bestEffect.createsFork && bestEffect.bestMovedPieceType) {
      const movedName = pieceName(bestEffect.bestMovedPieceType);
      return tr(
        `Hai visto la forchetta con il ${movedName}.`,
        `You spotted the fork with the ${movedName}.`,
      );
    }

    if (bestEffect.isCapture && bestEffect.capturedType) {
      const name = pieceName(bestEffect.capturedType);
      return tr(
        `Hai visto che il ${name} era in presa.`,
        `You spotted that the ${name} was there to take.`,
      );
    }

    return null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MoveFacts — structured deterministic facts about one position error.
// Used by coach-llm as grounding: the LLM voices facts, never invents them.
// ────────────────────────────────────────────────────────────────────────────

export interface MoveFacts {
  /** The most valuable friendly piece left en prise after the played move. */
  hung_piece: { type: string; square: string } | null;
  /**
   * The cheapest enemy punishment capture available after the played move.
   * Derived from cheapestCaptureOf on the hung piece square.
   */
  punishment: { capture_san: string; capturer_type: string; victim_square: string } | null;
  /**
   * What the best move achieves.
   * effect priority: mate > capture > save > fork > check > quiet
   */
  best: {
    san: string;
    effect: "mate" | "capture" | "save" | "fork" | "check" | "quiet";
    captured_type?: string;
    moved_type?: string;
  } | null;
  /** Tactical motif from pipeline (e.g. "pezzo_in_presa"). null if not available. */
  motif: string | null;
  /** Game phase label (italian from pipeline, e.g. "mediogioco"). null if not available. */
  phase: string | null;
  /** SAN of the move actually played. null if not resolvable. */
  played_san: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// extractMoveFacts — new export, zero LLM
//
// Emits only verifiable chess facts. Returns null when the position is
// invalid or there is no resolvable best move (consistent with buildMoveReason).
// ────────────────────────────────────────────────────────────────────────────

export function extractMoveFacts(input: MoveReasonInput): MoveFacts | null {
  try {
    const { fenBefore, myColor, playedSan, playedUci, bestUci, bestSan, motif, phase } = input;
    if (!fenBefore) return null;

    const myColorChess: "w" | "b" = myColor === "white" ? "w" : "b";

    // ── Resolve played move ───────────────────────────────────────────────
    const resolvedPlayedSan = resolveMove(fenBefore, playedSan, playedUci);
    if (!resolvedPlayedSan) return null;

    // ── Apply played move ─────────────────────────────────────────────────
    let fenAfterPlayed: string;
    try {
      const c = new Chess(fenBefore);
      const mv = c.move(resolvedPlayedSan, { strict: false } as never);
      if (!mv) return null;
      fenAfterPlayed = c.fen();
    } catch {
      return null;
    }

    // ── A) Hanging piece after played move ────────────────────────────────
    const hanging = findHangingPiece(fenAfterPlayed, myColorChess);

    // ── B) Punishment: cheapest enemy capture of the hung piece ───────────
    let punishment: MoveFacts["punishment"] = null;
    if (hanging) {
      const cap = cheapestCaptureOf(fenAfterPlayed, hanging.square, myColorChess);
      if (cap) {
        punishment = {
          capture_san: cap.san,
          capturer_type: cap.capturer_type,
          victim_square: cap.victim_square,
        };
      }
    }

    // ── C) Best move effect ───────────────────────────────────────────────
    const bestEffect = analyzeBestMove(
      fenBefore,
      bestUci ?? null,
      bestSan ?? null,
      myColorChess,
      hanging,
    );

    let best: MoveFacts["best"] = null;
    if (bestEffect.bestSanResolved) {
      let effect: "mate" | "capture" | "save" | "fork" | "check" | "quiet" = "quiet";
      if (bestEffect.isCheckmate) {
        effect = "mate";
      } else if (bestEffect.isCapture) {
        effect = "capture";
      } else if (hanging && bestEffect.savesPiece) {
        effect = "save";
      } else if (bestEffect.createsFork) {
        effect = "fork";
      } else if (bestEffect.isCheck) {
        effect = "check";
      }

      best = {
        san: bestEffect.bestSanResolved,
        effect,
        ...(bestEffect.capturedType ? { captured_type: bestEffect.capturedType } : {}),
        ...(bestEffect.bestMovedPieceType ? { moved_type: bestEffect.bestMovedPieceType } : {}),
      };
    }

    return {
      hung_piece: hanging ? { type: hanging.type, square: hanging.square } : null,
      punishment,
      best,
      motif: motif ?? null,
      phase: phase ?? null,
      played_san: resolvedPlayedSan,
    };
  } catch {
    return null;
  }
}
