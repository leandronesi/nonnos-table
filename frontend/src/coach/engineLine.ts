/**
 * engineLine.ts — calcola on-demand la linea del motore dopo la mossa giocata.
 *
 * Scopo: arricchire il campo punishment_line per le posizioni MAGRE (best.effect
 * === "quiet" e nessun pezzo in presa), dove i fatti deterministici da soli non
 * bastano a dare al maestro una lezione piena.
 *
 * Invarianti:
 * - lineAfterPlayedMove non lancia mai: qualsiasi errore → null.
 * - enrichPunishment non lancia mai: qualsiasi errore → input invariato.
 * - Niente eval extra se i fatti sono ricchi (caso tattico): zero overhead.
 */

import { Chess } from "chess.js";
import { getStockfishEngine } from "../pipeline/stockfishWorker";
import type { MoveFacts } from "../session/moveReason";

// ── lineAfterPlayedMove ───────────────────────────────────────────────────────

/**
 * Calcola la linea del motore a partire dalla posizione DOPO la mossa giocata.
 *
 * Passi:
 * 1. Applica la mossa giocata (SAN o UCI) al FEN dato → fenAfterPlayed.
 * 2. Aspetta che il motore Stockfish singleton sia pronto.
 * 3. Valuta fenAfterPlayed a depth 12.
 * 4. Prende result.pvUci; converte i primi maxPlies passi da UCI a SAN.
 * 5. Ritorna la stringa SAN (es. "Txd5 Cf6 Dg4") o null.
 *
 * @param fenBefore  FEN della posizione prima della mossa giocata.
 * @param playedSan  Mossa giocata in SAN (opzionale, tentata per prima).
 * @param playedUci  Mossa giocata in UCI (fallback se SAN null o invalida).
 * @param maxPlies   Numero massimo di semimossi da includere nella linea (default 4).
 */
export async function lineAfterPlayedMove(
  fenBefore: string,
  playedSan: string | null,
  playedUci: string | null,
  maxPlies = 4,
): Promise<string | null> {
  try {
    if (!fenBefore) return null;

    // ── 1. Applica la mossa giocata ──────────────────────────────────────────
    let fenAfterPlayed: string | null = null;

    if (playedSan) {
      try {
        const c = new Chess(fenBefore);
        const mv = c.move(playedSan, { strict: false } as never);
        if (mv) fenAfterPlayed = c.fen();
      } catch {
        // fallthrough to UCI
      }
    }

    if (!fenAfterPlayed && playedUci && playedUci.length >= 4) {
      try {
        const c = new Chess(fenBefore);
        const mv = c.move({
          from: playedUci.slice(0, 2),
          to: playedUci.slice(2, 4),
          promotion: playedUci.length > 4 ? playedUci.slice(4, 5) : undefined,
        });
        if (mv) fenAfterPlayed = c.fen();
      } catch {
        // ignore
      }
    }

    if (!fenAfterPlayed) return null;

    // ── 2. Attendi il motore e valuta ────────────────────────────────────────
    const engine = getStockfishEngine();
    await engine.waitReady();
    // Cap dell'attesa: una lezione posizionale non deve far fissare il loader
    // per i 12s del timeout interno di Stockfish. Se il motore tarda, lascia
    // perdere la linea e la lezione prosegue coi soli fatti deterministici.
    const result = await Promise.race([
      engine.evaluate(fenAfterPlayed, 12),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
    ]);

    if (!result || !result.pvUci) return null;

    // ── 3. Converti i primi maxPlies mosse da UCI a SAN ───────────────────────
    const uciMoves = result.pvUci.split(" ").filter(Boolean).slice(0, maxPlies);
    if (uciMoves.length === 0) return null;

    const sanMoves: string[] = [];
    const board = new Chess(fenAfterPlayed);

    for (const uci of uciMoves) {
      if (uci.length < 4) break;
      try {
        const mv = board.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
        });
        if (!mv) break;
        sanMoves.push(mv.san);
      } catch {
        break;
      }
    }

    if (sanMoves.length === 0) return null;
    return sanMoves.join(" ");
  } catch {
    // Any unexpected error: fail silently, never throw
    return null;
  }
}

// ── enrichPunishment ──────────────────────────────────────────────────────────

/**
 * Arricchisce l'input con la linea del motore solo per i casi MAGRI.
 *
 * Un caso e' "magro" quando:
 * - facts.best esiste e best.effect === "quiet" (nessuna cattura, nessun scacco,
 *   nessun salvataggio pezzo, nessuna forchetta)
 * - facts.hung_piece e' null (nessun pezzo in presa)
 *
 * In questo caso: chiama lineAfterPlayedMove e aggiunge pv_san_sf al risultato.
 * In tutti gli altri casi (tattico: punizione materiale gia' nei fatti): ritorna
 * l'input invariato. Zero eval extra, zero attesa.
 *
 * @param input  Oggetto input con almeno { fenBefore, playedSan?, playedUci?, pv_san_sf? }.
 * @param facts  MoveFacts deterministici gia' calcolati.
 */
export async function enrichPunishment<
  T extends {
    fenBefore: string;
    playedSan?: string | null;
    playedUci?: string | null;
    pv_san_sf?: string | null;
  },
>(input: T, facts: MoveFacts): Promise<T> {
  try {
    // Se pv_san_sf e' gia' valorizzato → niente da fare
    if (input.pv_san_sf) return input;

    // Solo per i casi magri: best "quiet" e nessun pezzo in presa
    const isQuiet = facts.best?.effect === "quiet";
    const noHang = !facts.hung_piece;
    if (!isQuiet || !noHang) return input;

    const line = await lineAfterPlayedMove(
      input.fenBefore,
      input.playedSan ?? null,
      input.playedUci ?? null,
    );

    // line null e' accettato: punishment_line resterà null, lezione si fa coi soli fatti
    return { ...input, pv_san_sf: line };
  } catch {
    // Any unexpected error: return input unchanged, never throw
    return input;
  }
}
