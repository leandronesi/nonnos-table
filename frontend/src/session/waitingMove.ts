/**
 * waitingMove.ts — la mossa d'attesa (firma #3 del prodotto, PRODUCT.md §10).
 *
 * "Li' era meglio aspettare, non forzare quando non vedi."
 *
 * Qui vivono le due parti PURE della mossa d'attesa, estratte da MomentReview
 * perche' sono le due che possono sbagliare in silenzio:
 *
 *   1. shouldOfferWaitingMove — QUANDO ha senso proporla
 *   2. orderWaitingCandidates — QUALI mosse vale la pena valutare
 *
 * La valutazione Stockfish vera e propria resta nel componente: dipende dal
 * worker e non e' testabile senza motore.
 *
 * Condizione canonica (docs/BUILD.md §SLICE 4, backend/compute_waiting_moves.py):
 * la mossa giusta e' troppo difficile per il livello attuale, cioe'
 * `p_maia_mine_top < 0.20`, E la posizione non e' forzante.
 */

/** Soglia canonica: sotto questa, la mossa giusta e' fuori portata oggi. */
export const WAITING_MAX_MINE_TOP = 0.2;

export interface WaitingGateInput {
  /** Massima policy legale al livello attuale (0..1). */
  pMaiaMineTop?: number | null;
  /** Stato Maia della posizione: la soglia ha senso solo su "scored". */
  maiaStatus?: string | null;
}

/**
 * La mossa giusta e' troppo difficile per il livello attuale?
 *
 * Ritorna false quando non lo sappiamo. E' la differenza che conta: proporre
 * una mossa d'attesa perche' il dato manca significa dire "questa non la vedi"
 * a qualcuno che magari la vedeva benissimo.
 */
export function shouldOfferWaitingMove(input: WaitingGateInput): boolean {
  if (input.maiaStatus != null && input.maiaStatus !== "scored") return false;
  const top = input.pMaiaMineTop;
  if (top == null || !Number.isFinite(top)) return false;
  return top < WAITING_MAX_MINE_TOP;
}

/** Forma minima di una mossa chess.js verbose, per non legare il modulo al tipo. */
export interface CandidateMove {
  san: string;
  piece: string;
  flags: string;
  captured?: string;
}

/**
 * Ordina i candidati mettendo davanti le mosse "normalizzanti".
 *
 * Una mossa d'attesa vera e' quasi sempre una mossa che sistema invece di
 * cercare: arrocco, mossa di re, spinta di pedone tranquilla, miglioramento di
 * un pezzo. Valutiamo solo i primi N candidati per non bloccare la Sessione,
 * quindi l'ordine decide COSA viene valutato, non solo in che sequenza: senza
 * ordinamento si valutavano i primi sei in ordine di scacchiera, che e' un
 * ordine arbitrario.
 *
 * Non muta l'array in ingresso.
 */
export function orderWaitingCandidates<T extends CandidateMove>(moves: T[]): T[] {
  return [...moves].sort((a, b) => rank(a) - rank(b));
}

function rank(m: CandidateMove): number {
  const isCapture = m.flags.includes("c") || m.flags.includes("e") || m.captured != null;
  const isPromotion = m.flags.includes("p");
  // Catture e promozioni non sono mosse d'attesa: in fondo, se mai ci arriviamo.
  if (isCapture || isPromotion) return 4;
  if (m.flags.includes("k") || m.flags.includes("q")) return 0; // arrocco
  if (m.piece === "k") return 1; // mossa di re
  if (m.piece === "p") return 2; // spinta tranquilla
  return 3; // altro pezzo, mossa tranquilla
}
