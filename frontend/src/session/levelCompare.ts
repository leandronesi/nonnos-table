/**
 * levelCompare.ts — "Piu' naturale al target" (deterministico, solo dati posizione).
 *
 * Firma #2 del prodotto (PRODUCT.md §10): confrontare il giocatore col PROPRIO
 * livello, mai col computer. PRODUCT.md §0.6 (righe 96-98) autorizza esattamente
 * tre forme per dirlo: «piu' naturale al target», «nessun divario netto», oppure
 * un indice/lift esplicitamente relativo.
 *
 * Fino a qui il prodotto usava solo la terza, l'indice numerico: corretta ma
 * impronunciabile da un nonno. Questo modulo dice la PRIMA, in voce; l'indice
 * resta disponibile come dettaglio secondario sotto.
 *
 * Regola d'oro, la stessa di moveReason.ts: emetti solo cio' che il dato
 * autorizza, altrimenti taci. Una frase falsa e' peggio del silenzio.
 *
 * VINCOLO DI VERITA' (§0.6 righe 91-93): i valori della policy Maia sono indici
 * relativi sullo stesso FEN, NON frequenze calibrate sui giocatori. Nessuna
 * formulazione qui puo' quindi implicare «N giocatori su M la trovano» ne'
 * «chi gioca a 1600 la trova»: sono affermazioni sulle PERSONE, vietate dal §0.6
 * come «formule equivalenti». Si parla della MOSSA, non dei giocatori.
 */

import { tr } from "../i18n/lang";

export interface LevelCompareInput {
  /**
   * Massa di policy sulle mosse ACCETTABILI osservate, al livello attuale (0..1).
   * Si usa questa, non p_maia_mine_top: il top e' il massimo sulla policy legale,
   * cioe' quanto il modello e' deciso, non quanto la mossa giusta sia naturale.
   * La domanda qui e' la seconda.
   */
  pMineAcceptable?: number | null;
  /** Stessa massa al livello obiettivo (0..1). */
  pTargetAcceptable?: number | null;
  /** Rating obiettivo dichiarato, per nominarlo invece di dire "il target". */
  targetRating?: number | null;
  /** Stato Maia della posizione: si parla solo su "scored". */
  maiaStatus?: string | null;
}

/**
 * Lift minimo sull'indice relativo prima che il divario meriti una frase.
 * Sotto questa soglia siamo nel caso «nessun divario netto» del §0.6, che qui
 * trattiamo col silenzio: la Sessione ha gia' il verdetto della mossa, una
 * riga in piu' che dice "non c'e' differenza" sarebbe rumore.
 */
const MIN_LIFT = 0.1;

/**
 * Costruisce la riga "piu' naturale al target", oppure null.
 *
 * Ritorna null quando: Maia non ha valutato la posizione, manca uno dei due
 * indici, i valori non sono finiti, o il divario e' sotto MIN_LIFT.
 */
export function buildLevelCompare(input: LevelCompareInput): string | null {
  // Maia deve aver davvero valutato questa posizione. maiaStatus assente =
  // analisi vecchia senza il campo: in quel caso decidono gli indici sotto.
  if (input.maiaStatus != null && input.maiaStatus !== "scored") return null;

  const mine = input.pMineAcceptable;
  const target = input.pTargetAcceptable;
  if (mine == null || target == null) return null;
  if (!Number.isFinite(mine) || !Number.isFinite(target)) return null;

  // «nessun divario netto» -> silenzio.
  if (target - mine < MIN_LIFT) return null;

  const rating = input.targetRating;
  const hasRating = rating != null && Number.isFinite(rating) && rating > 0;

  if (hasRating) {
    return tr(
      `Una mossa cosi' viene piu' naturale a ${rating}. Oggi, ancora no.`,
      `A move like this comes more naturally at ${rating}. Not yet, today.`,
    );
  }

  return tr(
    "Una mossa cosi' viene piu' naturale al livello verso cui stai andando. Oggi, ancora no.",
    "A move like this comes more naturally at the level you are heading for. Not yet, today.",
  );
}
