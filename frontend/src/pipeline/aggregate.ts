/**
 * Aggregati: combina le analisi singole partita in un riassunto utile per il
 * coach brief LLM. Versione "lazy port" — pochi numeri ma significativi.
 *
 * Input: tutte le `GameAnalysis` dell'utente (da Storage).
 * Output: `Aggregates` salvato come `quaderno/aggregates.json`, che include
 * anche `examples`: le mosse peggiori con la posizione concreta (FEN, mossa
 * giocata vs migliore), così il coach LLM parla di partite VERE, non solo di %.
 *
 * Da qui in poi è il LLM (edge function) a generare le frasi del coach brief
 * e del coach_journal a partire da questo JSON.
 */

import { supabase } from "../auth/supabaseClient";
import { downloadJson, uploadJson, analysisPath, quadernoPath } from "../auth/storage";
import type { GameAnalysis } from "./analyze";
import { getMaiaEngine } from "./maia/maiaEngine";
import { FREE_GAME_CAP, MAX_COACH_EXAMPLES, CADUTE_LIMIT, CADUTE_MAIA_CAP, ANALYZED_TIME_CLASSES } from "./config";
import type { AnchorTrendNow, TransferAggregates, TransferMotifStat, TransferMotifType, MotifOccurrence } from "../types";

export interface PhaseAgg {
  moves: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  blunder_pct: number;
  mistake_pct: number;
  inaccuracy_pct: number;
  avg_cp_loss: number;
}

export interface TimeClassAgg {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  avg_cp_loss: number;
}

export interface ColorAgg {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  avg_cp_loss: number;
  blunder_pct: number;
}

/** Una mossa-esempio concreta (mossa peggiore) per il coach LLM. */
export interface PositionExample {
  played_at?: string;
  color: "white" | "black";
  phase: string;
  ply: number;
  san: string;
  played_uci: string;
  best_uci: string | null;
  cp_loss: number;
  fen_before: string;
  category: "blunder" | "mistake";
  /** Motif tattico v1 (es. "pezzo_in_presa"). null se non rilevato. */
  motif?: string | null;
  /**
   * Difficolta' della posizione (0..1).
   * Se Maia disponibile: 1 - p_maia_target_top (vera Maia, sovrascrive proxy Stockfish).
   * Altrimenti: proxy Stockfish (gap linee). null se non calcolabile.
   */
  move_difficulty?: number | null;
  /** Ultima mossa dell'avversario immediatamente prima di questa mossa del player. */
  last_opp_from?: string | null;
  last_opp_to?: string | null;
  last_opp_san?: string | null;
  /** Opening name della partita, propagato dall'header PGN. null se assente. */
  opening?: string | null;
  /** ECO code della partita (es. "B12"), propagato dall'header PGN. null se assente. */
  eco?: string | null;
  // Campi aggiunti dalla parametrizzazione errori (B3).
  error_type?: string | null;
  blame_weight?: number | null;
  state_before?: string | null;
  time_state?: string | null;
  clock_remaining?: number | null;
  /** Secondi spesi dal player su questa mossa (da PGN [%clk]). null se assente. */
  spent_seconds?: number | null;
  /** URL Chess.com della partita (es. "https://www.chess.com/game/live/12345"). null se assente. */
  game_url?: string | null;
  // ── Campi Maia (popolati solo se engine disponibile) ──────────────────────
  /** Prob che Maia@mio livello giochi la mossa Stockfish-best. */
  p_mine_plays_best_sf?: number | null;
  /** Prob che Maia@target giochi la mossa Stockfish-best. */
  p_target_plays_best_sf?: number | null;
  /** Top-policy del mio livello (quanto "ovvia" e' la posizione per me). */
  p_maia_mine_top?: number | null;
  /** Top-policy del target (quanto "ovvia" e' per chi voglio diventare). */
  p_maia_target_top?: number | null;
  /**
   * drill_value = p_target_plays_best_sf - p_mine_plays_best_sf.
   * Il "money": il target la trova, tu no.
   */
  drill_value?: number | null;
  /**
   * 3=money / 2=avoidable / 1=critico raw / 0=skip.
   * 0 se move_difficulty < 0.15 OPPURE opening (ply <= 16) OPPURE p_target < 0.5.
   * null se Maia non disponibile.
   */
  priority_score?: number | null;
  /** True se priority_score >= 2 (posizione su cui vale la pena esercitarsi). */
  avoidable?: boolean | null;
}

/**
 * Metriche aggregate pesate per difficolta' Maia.
 *
 * Calcolate sulle mosse-errore arricchite da Maia (priority_score != null).
 * null se Maia non ha girato (currentRating non fornito o engine fallito).
 *
 * Lettura di riferimento: PRODUCT_VISION.md §2 "la difficolta' e' la moneta".
 */
export interface MaiaWeighted {
  /** Quante mosse-errore hanno ricevuto lo scoring Maia. */
  errors_scored: number;
  /**
   * Mosse con avoidable===true (priority_score>=2): le trovavi al tuo livello,
   * sono i tuoi veri freni.
   */
  avoidable: number;
  /**
   * Mosse con p_target_plays_best_sf < 0.5: nemmeno il target le avrebbe
   * trovate. Non e' colpa tua — e' il prossimo gradino.
   */
  unavoidable: number;
  /** Media di p_mine_plays_best_sf * 100 sulle posizioni con Maia (0..100). */
  mine_pct: number;
  /** Media di p_target_plays_best_sf * 100 sulle posizioni con Maia (0..100). */
  target_pct: number;
  /**
   * target_pct - mine_pct: il divario col target.
   * Positivo = il target trova la mossa piu' spesso di te.
   */
  gap_pct: number;
  /** avoidable / errors_scored (0..1). Frazione di errori su cui vale lavorare. */
  avoidable_share: number;
  /**
   * Per fase ("apertura"/"mediogioco"/"finale") -> { errors, avoidable }.
   * Usa le etichette italiane come in PositionExample.phase.
   */
  by_phase_avoidable: Record<string, { errors: number; avoidable: number }>;
  /**
   * Cross "tempo speso x evitabilita'": distribuisce gli errori-con-Maia per
   * bucket di spent_seconds e mostra quanti erano avoidable in ciascun bucket.
   *
   * Tesi (PRODUCT_VISION §2): errori in fretta su mosse evitabili sono il
   * problema reale; errori dopo lunga riflessione su mosse difficili non sono
   * colpa tua.
   *
   * Solo le mosse con priority_score != null E spent_seconds != null entrano
   * nel calcolo. Bucket vuoti vengono omessi (array puo' essere vuoto).
   *
   * bucket labels: "< 5 s" / "5-15 s" / "15-30 s" / "30-60 s" / "> 60 s"
   * key values:    "lt_5s" / "5_15s"  / "15_30s"  / "30_60s"  / "gt_60s"
   */
  spent_vs_avoidable: { bucket: string; key: string; errors: number; avoidable: number }[];
}

/**
 * Profilo di debolezza aggregato per tipo di errore.
 *
 * Rinominato da Weakness ad Anchor (M2).
 * Esclude "in_lost_position" dalla lista principale (troppo rumore, peso 0.1).
 */
export interface Anchor {
  type: string;
  label_it: string;
  meaning_it: string;
  action_it: string;
  category: "tattica" | "timing" | "tecnica" | "comportamento";
  count: number;
  /**
   * Number of errors in this anchor where priority_score >= 2 (Maia-avoidable).
   * 0 if Maia did not run (all priority_score null).
   * Subset of `count` — does NOT replace it.
   */
  count_avoidable: number;
  share_of_errors: number;
  games_with: number;
  avg_cp_loss: number;
  /**
   * Stima grezza dei punti ELO recuperabili = round(share_of_errors * 100),
   * cappata a [0..60]. null se non stimabile.
   */
  rating_upside: number | null;
  /**
   * Punteggio ordinamento: se Maia disponibile, Σ(drill_value * impact);
   * altrimenti Σ(blameWeight * cp_loss). Escluse posizioni priority_score 0.
   */
  weighted_score: number;
  /**
   * Media di p_maia_mine_top sugli exemplar di questa ancora dove Maia ha girato.
   * Proxy di "quanto ovvia" e' questa ancora per il tuo livello.
   * null se Maia non ha girato per nessun errore di questa ancora.
   */
  mine_pct: number | null;
  /**
   * Media di p_maia_target_top sugli exemplar di questa ancora dove Maia ha girato.
   * null se Maia non ha girato per nessun errore di questa ancora.
   */
  target_pct: number | null;
  exemplars: PositionExample[];
  /**
   * Trend finestrato immediato (§2.1 BUILD.md).
   * Frequenza errore normalizzata su finestre 28/28 gg sulla data della partita.
   * null se dati insufficienti.
   */
  trend_now?: AnchorTrendNow | null;
}

/** @deprecated Usa Anchor. Mantenuto per compatibilita' con i lettori esistenti. */
export type Weakness = Anchor;

/**
 * Riga del Repertorio: statistiche di una apertura specifica per colore.
 *
 * Tesi ("difficolta' e' la moneta"): la colonna guida e' `avoidable`, cioe'
 * i punti persi su errori che Maia dice che al tuo livello potevi evitare.
 * win_rate e' presente ma NON usato come metrica principale (rumore su Unknown).
 *
 * `recognized` = false raggruppa le aperture senza nome/ECO in un'unica riga
 * "Apertura non riconosciuta" per colore — separata dal ranking principale.
 */
export interface RepertoireRow {
  eco: string;
  opening: string;
  my_color: "white" | "black";
  games: number;
  wins: number;
  /**
   * Percentuale vittorie (0..1). null se games < 4: troppo poche per essere
   * significativo (evita rumore su aperture giocate 1-2 volte).
   */
  win_rate: number | null;
  /** ACPL medio pesato sui moves di tutte le partite nel gruppo. */
  avg_acpl: number;
  /** Totale errori (blunder+mistake) dalle mosse-errore di questo gruppo. */
  errors: number;
  /**
   * Errori con avoidable===true (Maia: al tuo livello potevi evitarli).
   * 0 se Maia non ha girato (graceful: lettori non devono null-check).
   */
  avoidable: number;
  /**
   * true = apertura riconosciuta (opening != null/Unknown e/o eco != null/"??").
   * false = raggruppata in "Apertura non riconosciuta".
   */
  recognized: boolean;
}

export interface Aggregates {
  generated_at: string;
  games_analyzed: number;
  player_moves_total: number;
  blunder_pct: number;
  mistake_pct: number;
  inaccuracy_pct: number;
  avg_cp_loss: number;
  by_phase: Record<"opening" | "middlegame" | "endgame", PhaseAgg>;
  by_time_class: Record<string, TimeClassAgg>;
  by_color: { white: ColorAgg; black: ColorAgg };
  examples?: PositionExample[];
  cadute?: PositionExample[];
  /** Profili ancora ordinati per weighted_score desc. Escluso "in_lost_position". */
  anchors: Anchor[];
  /** @deprecated Alias di anchors per compatibilita'. */
  weaknesses: Anchor[];
  /**
   * Metriche pesate per difficolta' Maia. null se Maia non ha girato
   * (currentRating non fornito o engine non disponibile). Graceful: i lettori
   * devono sempre fare il null-check prima di usare questo campo.
   */
  maia_weighted?: MaiaWeighted | null;
  /**
   * Repertorio aperture: top ~10 riconosciute ordinate per avoidable desc,
   * poi errors desc, poi games desc. Le non-riconosciute sono separate (in coda,
   * recognized=false, una riga per colore) e non competono nel ranking principale.
   * undefined se nessuna partita analizzata.
   */
  repertoire?: RepertoireRow[];
  /**
   * Transfer metrics: faced/handled/rate per motif, windowed and overall (§7.3 BUILD.md).
   *
   * HEURISTIC: motif classification uses chess.js geometry — approximate.
   * `rate` is null when `faced` is below the minimum threshold (sparse data).
   * undefined if no motif_occurrences data available (old analysis files).
   */
  transfer?: TransferAggregates;
}

function emptyPhase(): PhaseAgg {
  return {
    moves: 0,
    blunders: 0,
    mistakes: 0,
    inaccuracies: 0,
    blunder_pct: 0,
    mistake_pct: 0,
    inaccuracy_pct: 0,
    avg_cp_loss: 0,
  };
}

function emptyColor(): ColorAgg {
  return {
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    win_rate: 0,
    avg_cp_loss: 0,
    blunder_pct: 0,
  };
}

function phaseIt(phase: string): string {
  if (phase === "opening") return "apertura";
  if (phase === "endgame") return "finale";
  return "mediogioco";
}

/** Metadati italiani per ogni tipo di errore. Testi in chiave AVANTI (upside). */
export const WEAKNESS_META: Record<string, Pick<Anchor, "label_it" | "meaning_it" | "action_it" | "category">> = {
  careless: {
    label_it: "Disattenzione",
    meaning_it: "Errori in posizioni non difficili dove avevi tempo e la mossa non era complicata. Se molli questa ancora guadagni punti sulle partite facili.",
    action_it: "Prima di muovere, un controllo veloce: cosa minaccia l'avversario.",
    category: "tattica",
  },
  hung_piece: {
    label_it: "Pezzi in presa",
    meaning_it: "Lasci pezzi catturabili gratis. Se smetti di regalare materiale sali di rating direttamente.",
    action_it: "Controlla sempre le catture dell'avversario prima di muovere.",
    category: "tattica",
  },
  rushed: {
    label_it: "Mosse impulsive",
    meaning_it: "Muovi troppo in fretta in momenti che chiedono calcolo. Rallentare nei critici vale punti concreti.",
    action_it: "Datti qualche secondo in piu' sui momenti critici.",
    category: "timing",
  },
  conversion: {
    label_it: "Vittorie buttate",
    meaning_it: "Eri in vantaggio e hai lasciato sfuggire la partita. Imparare a chiudere e' il salto di qualita' piu' diretto.",
    action_it: "Quando sei avanti semplifica e gioca solido.",
    category: "tecnica",
  },
  zeitnot: {
    label_it: "Crolli in zeitnot",
    meaning_it: "Sbagli quando il tempo sta per finire. Gestire meglio l'orologio ti porta a convertire queste partite.",
    action_it: "Gestisci meglio l'orologio nelle fasi iniziali.",
    category: "timing",
  },
  missed_tactic: {
    label_it: "Tattiche mancate",
    meaning_it: "Posizioni acute con una mossa precisa che hai mancato. Riconoscere i pattern tattici e' il tuo prossimo gradino.",
    action_it: "Allena i pattern tattici ricorrenti.",
    category: "tattica",
  },
  hard_calc: {
    label_it: "Calcolo al limite",
    meaning_it: "Posizioni difficili dove ci hai pensato ma non l'hai trovata: e' il tuo prossimo gradino di crescita.",
    action_it: "Esercizi di calcolo piu' profondo.",
    category: "tattica",
  },
};

// ── Maia batch helper ─────────────────────────────────────────────────────────

const MAIA_CHUNK_SIZE = 24;

interface MaiaFields {
  p_mine_plays_best_sf: number;
  p_target_plays_best_sf: number;
  p_maia_mine_top: number;
  p_maia_target_top: number;
  move_difficulty: number;
  drill_value: number;
  priority_score: number;
  avoidable: boolean;
}

/**
 * Runs Maia on a list of error positions and returns MaiaFields per index.
 * Returns null map on any failure — callers must handle gracefully.
 */
async function enrichWithMaia(
  positions: Array<{ fen_before: string; best_uci: string | null; phase: string; ply: number }>,
  currentRating: number,
  targetRating: number,
): Promise<Map<number, MaiaFields>> {
  const result: Map<number, MaiaFields> = new Map();

  try {
    const engine = getMaiaEngine();
    await engine.waitReady();

    // Build two evaluations per position: [mine, target] interleaved.
    // Index in combined batch: i*2 = mine, i*2+1 = target.
    const fens: string[] = [];
    const eloSelfs: number[] = [];
    const eloOppos: number[] = [];
    const indexMap: number[] = []; // maps combined-batch index back to position index

    for (let i = 0; i < positions.length; i++) {
      const fen = positions[i].fen_before;
      // mine: eloSelf = eloOppo = currentRating
      fens.push(fen);
      eloSelfs.push(currentRating);
      eloOppos.push(currentRating);
      indexMap.push(i);
      // target: eloSelf = eloOppo = targetRating
      fens.push(fen);
      eloSelfs.push(targetRating);
      eloOppos.push(targetRating);
      indexMap.push(i);
    }

    // Process in chunks to avoid huge single ONNX batch.
    const chunkCount = Math.ceil(fens.length / MAIA_CHUNK_SIZE);
    const allResults: Array<{ policy: Record<string, number>; value: number }> = [];

    for (let c = 0; c < chunkCount; c++) {
      const start = c * MAIA_CHUNK_SIZE;
      const end = Math.min(start + MAIA_CHUNK_SIZE, fens.length);
      const chunkFens = fens.slice(start, end);
      const chunkSelfs = eloSelfs.slice(start, end);
      const chunkOppos = eloOppos.slice(start, end);
      const chunkResults = await engine.batchEvaluate(chunkFens, chunkSelfs, chunkOppos);
      allResults.push(...chunkResults);
    }

    // Pair up mine/target for each position.
    for (let i = 0; i < positions.length; i++) {
      const mineResult = allResults[i * 2];
      const targetResult = allResults[i * 2 + 1];
      if (!mineResult || !targetResult) continue;

      const bestUci = positions[i].best_uci;
      const policyMine = mineResult.policy;
      const policyTarget = targetResult.policy;

      const p_mine_plays_best_sf = bestUci != null ? (policyMine[bestUci] ?? 0) : 0;
      const p_target_plays_best_sf = bestUci != null ? (policyTarget[bestUci] ?? 0) : 0;

      const p_maia_mine_top =
        Object.keys(policyMine).length > 0
          ? Math.max(...Object.values(policyMine))
          : 0;
      const p_maia_target_top =
        Object.keys(policyTarget).length > 0
          ? Math.max(...Object.values(policyTarget))
          : 0;

      // Canonical Maia formulas from docs/MAIA_BROWSER.md.
      const move_difficulty = 1 - p_maia_target_top;
      const drill_value = p_target_plays_best_sf - p_mine_plays_best_sf;

      // priority_score: 0 if trivial, no-book, or target also misses.
      // Opening guard: ply <= 16 (move_number <= 8 counting both sides).
      const isOpening = positions[i].ply <= 16;
      let priority_score: number;
      if (move_difficulty < 0.15 || isOpening || p_target_plays_best_sf < 0.5) {
        priority_score = 0;
      } else if (drill_value >= 0.25) {
        priority_score = 3;
      } else if (p_mine_plays_best_sf >= 0.5) {
        priority_score = 2;
      } else {
        priority_score = 1;
      }

      result.set(i, {
        p_mine_plays_best_sf,
        p_target_plays_best_sf,
        p_maia_mine_top,
        p_maia_target_top,
        move_difficulty,
        drill_value,
        priority_score,
        avoidable: priority_score >= 2,
      });
    }
  } catch (err) {
    // Graceful: Maia unavailable, return empty map. Callers fall back to Stockfish proxy.
    console.warn("[aggregate] Maia enrichment skipped:", err);
  }

  return result;
}

// ── Transfer aggregates (§7.3 BUILD.md) ──────────────────────────────────────

/**
 * Minimum number of faced occurrences to compute a meaningful rate.
 * Below this threshold, `rate` is null ("dato insufficiente").
 */
const MIN_FACED_FOR_RATE = 3;

/** All tracked motif types (excludes "none" from the per-motif breakdown). */
const TRANSFER_MOTIFS: TransferMotifType[] = ["hanging_piece", "fork", "back_rank"];

/**
 * Builds per-motif TransferMotifStat[] from a list of occurrences.
 * Only the 3 tactical motifs are reported (not "none" — it's the null/rest category).
 */
function buildTransferStats(occurrences: MotifOccurrence[]): TransferMotifStat[] {
  const faced: Record<TransferMotifType, number> = { hanging_piece: 0, fork: 0, back_rank: 0, none: 0 };
  const handled: Record<TransferMotifType, number> = { hanging_piece: 0, fork: 0, back_rank: 0, none: 0 };

  for (const occ of occurrences) {
    faced[occ.motif]++;
    if (occ.handled) handled[occ.motif]++;
  }

  return TRANSFER_MOTIFS.map((motif) => {
    const f = faced[motif];
    const h = handled[motif];
    return {
      motif,
      faced: f,
      handled: h,
      rate: f >= MIN_FACED_FOR_RATE ? h / f : null,
    };
  });
}

/**
 * Computes TransferAggregates from all motif_occurrences across analyzed games.
 *
 * Windowing: relative to the most recent `played_at` in the occurrences.
 *   recent = [maxDate - 27d .. maxDate]
 *   prior  = [maxDate - 55d .. maxDate - 28d]
 *
 * Returns undefined if there are no occurrences (old analysis files, no data).
 */
function computeTransferAggregates(
  allOccurrences: MotifOccurrence[],
): TransferAggregates | undefined {
  if (allOccurrences.length === 0) return undefined;

  // Find the most recent played_at.
  let maxDateMs = 0;
  for (const occ of allOccurrences) {
    if (occ.played_at) {
      const t = Date.parse(occ.played_at);
      if (!isNaN(t) && t > maxDateMs) maxDateMs = t;
    }
  }
  if (maxDateMs === 0) return undefined;

  const MS_PER_DAY = 86_400_000;
  const recentEnd   = maxDateMs;
  const recentStart = maxDateMs - 27 * MS_PER_DAY;
  const priorEnd    = maxDateMs - 28 * MS_PER_DAY;
  const priorStart  = maxDateMs - 55 * MS_PER_DAY;

  const recentOcc: MotifOccurrence[] = [];
  const priorOcc: MotifOccurrence[] = [];

  for (const occ of allOccurrences) {
    if (!occ.played_at) continue;
    const t = Date.parse(occ.played_at);
    if (isNaN(t)) continue;
    if (t >= recentStart && t <= recentEnd) recentOcc.push(occ);
    else if (t >= priorStart && t <= priorEnd) priorOcc.push(occ);
  }

  return {
    overall: buildTransferStats(allOccurrences),
    recent:  buildTransferStats(recentOcc),
    prior:   buildTransferStats(priorOcc),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Computes player aggregates across the last FREE_GAME_CAP analyzed games.
 *
 * @param userId        Supabase user id.
 * @param currentRating Player's current ELO (used for Maia enrichment). null = skip Maia.
 * @param targetRating  Player's target ELO (used for Maia enrichment). Defaults to
 *                      currentRating + 200 if not provided; ignored if currentRating null.
 */
export async function computeAggregates(
  userId: string,
  currentRating: number | null = null,
  targetRating: number = (currentRating ?? 1200) + 200,
): Promise<Aggregates> {
  // FIX B: filter rapid/blitz IN SQL so the FREE_GAME_CAP quota contains 100
  // rapid/blitz games, not 100 mixed games (daily/bullet would silently consume
  // cap slots and halve the analysed volume for mixed-format players).
  // The in-memory filter below is kept as a redundant safety net.
  const { data: games } = await supabase
    .from("games")
    .select("id,chess_com_uuid,time_class,color,result,analysis_path,analysis_status")
    .eq("user_id", userId)
    .eq("analysis_status", "done")
    .in("time_class", ANALYZED_TIME_CLASSES)
    .order("played_at", { ascending: false })
    .limit(FREE_GAME_CAP);

  let movesTotal = 0;
  let blundersTotal = 0;
  let mistakesTotal = 0;
  let inaccTotal = 0;
  let cpLossSum = 0;

  const byPhase = {
    opening: emptyPhase(),
    middlegame: emptyPhase(),
    endgame: emptyPhase(),
  };
  const phaseCpLossSum: Record<"opening" | "middlegame" | "endgame", number> = {
    opening: 0,
    middlegame: 0,
    endgame: 0,
  };
  const byTimeClass: Record<string, TimeClassAgg & { cpLossSum: number; moves: number }> = {};
  const byColor: {
    white: ColorAgg & { cpLossSum: number; blunders: number; moves: number };
    black: ColorAgg & { cpLossSum: number; blunders: number; moves: number };
  } = {
    white: { ...emptyColor(), cpLossSum: 0, blunders: 0, moves: 0 },
    black: { ...emptyColor(), cpLossSum: 0, blunders: 0, moves: 0 },
  };

  const exampleCandidates: Array<PositionExample & { gameKey: string }> = [];

  // ── Transfer: collect all motif_occurrences across games ─────────────────────
  // Occurrences come from GameAnalysis.motif_occurrences (undefined on old files → skip).
  const allMotifOccurrences: MotifOccurrence[] = [];

  // ── Repertorio accumulator ───────────────────────────────────────────────────
  // Key: "<eco>|<opening>|<color>" — built per-game, errors/avoidable added post-Maia.
  interface RepertoireAccEntry {
    eco: string;
    opening: string;
    my_color: "white" | "black";
    recognized: boolean;
    games: number;
    wins: number;
    cpLossSum: number;
    movesTotal: number;
    errors: number;
    avoidable: number;
    gameKeys: Set<string>;
  }
  const repertoireAcc: Map<string, RepertoireAccEntry> = new Map();

  let analyzedCount = 0;
  // All played_at timestamps of games that passed the filter (for trend denominators).
  // This includes games with zero errors — required for an honest errors-per-game rate.
  const allAnalyzedPlayedAt: string[] = [];

  for (const g of games ?? []) {
    if (!g.analysis_path) continue;
    const ga = await downloadJson<GameAnalysis>(g.analysis_path);
    if (!ga) continue;

    // Filter: only rapid/blitz contribute to error analysis and anchor scoring.
    // If time_class is missing/undefined we keep the game (conservative).
    // Daily games have unusable clock data; bullet produces noisy cp_loss.
    if (ga.time_class && !ANALYZED_TIME_CLASSES.includes(ga.time_class)) continue;

    analyzedCount++;
    // Track played_at of every filtered game — used as denominator in trend_now.
    if (ga.played_at) allAnalyzedPlayedAt.push(ga.played_at);

    // Collect motif occurrences for transfer metrics (§7.3). Old analysis files
    // will have motif_occurrences === undefined — silently skip them.
    if (ga.motif_occurrences && ga.motif_occurrences.length > 0) {
      for (const occ of ga.motif_occurrences) {
        allMotifOccurrences.push(occ);
      }
    }

    movesTotal += ga.total_player_moves;
    blundersTotal += ga.blunders;
    mistakesTotal += ga.mistakes;
    inaccTotal += ga.inaccuracies;
    cpLossSum += ga.avg_cp_loss * ga.total_player_moves;

    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      const p = ga.by_phase[phase];
      byPhase[phase].moves += p.moves;
      byPhase[phase].blunders += p.blunders;
      byPhase[phase].mistakes += p.mistakes;
      byPhase[phase].inaccuracies += p.inaccuracies;
      phaseCpLossSum[phase] += p.avg_cp_loss * p.moves;
    }

    // by time class
    const tc = ga.time_class;
    if (!byTimeClass[tc]) {
      byTimeClass[tc] = {
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        win_rate: 0,
        avg_cp_loss: 0,
        cpLossSum: 0,
        moves: 0,
      };
    }
    const tcAgg = byTimeClass[tc];
    tcAgg.games++;
    if (ga.result === "win") tcAgg.wins++;
    else if (ga.result === "draw") tcAgg.draws++;
    else tcAgg.losses++;
    tcAgg.cpLossSum += ga.avg_cp_loss * ga.total_player_moves;
    tcAgg.moves += ga.total_player_moves;

    // by color
    const colorAgg = byColor[ga.color];
    colorAgg.games++;
    if (ga.result === "win") colorAgg.wins++;
    else if (ga.result === "draw") colorAgg.draws++;
    else colorAgg.losses++;
    colorAgg.cpLossSum += ga.avg_cp_loss * ga.total_player_moves;
    colorAgg.blunders += ga.blunders;
    colorAgg.moves += ga.total_player_moves;

    // ── Repertorio: accumula per (eco|opening|color) ─────────────────────────
    {
      const rawOpening = ga.opening ?? null;
      const rawEco = ga.eco ?? null;
      const recognized =
        (rawOpening != null && rawOpening !== "Unknown") ||
        (rawEco != null && rawEco !== "??");
      // Non-riconosciute vengono aggregate in un'unica riga per colore.
      const ecoKey = recognized ? (rawEco ?? "??") : "??";
      const openingKey = recognized ? (rawOpening ?? "Unknown") : "Apertura non riconosciuta";
      const repertoireKey = `${ecoKey}|${openingKey}|${ga.color}`;
      if (!repertoireAcc.has(repertoireKey)) {
        repertoireAcc.set(repertoireKey, {
          eco: ecoKey,
          opening: openingKey,
          my_color: ga.color,
          recognized,
          games: 0,
          wins: 0,
          cpLossSum: 0,
          movesTotal: 0,
          errors: 0,
          avoidable: 0,
          gameKeys: new Set(),
        });
      }
      const rRow = repertoireAcc.get(repertoireKey)!;
      rRow.games++;
      if (ga.result === "win") rRow.wins++;
      rRow.cpLossSum += ga.avg_cp_loss * ga.total_player_moves;
      rRow.movesTotal += ga.total_player_moves;
      rRow.gameKeys.add(ga.chess_com_uuid);
    }

    // Esempi: le mosse dove ha perso piu' valore (blunder/mistake), con la
    // posizione concreta. Servono al coach per parlare di partite vere.
    for (const mv of ga.moves) {
      if (mv.category === "blunder" || mv.category === "mistake") {
        exampleCandidates.push({
          gameKey: ga.chess_com_uuid,
          played_at: ga.played_at,
          color: ga.color,
          phase: phaseIt(mv.phase),
          ply: mv.ply,
          san: mv.san,
          played_uci: mv.uci,
          best_uci: mv.bestMoveUci,
          cp_loss: mv.cpLoss,
          fen_before: mv.fenBefore,
          category: mv.category,
          motif: mv.motif ?? null,
          move_difficulty: mv.moveDifficulty ?? null, // may be overwritten by Maia below
          last_opp_from: mv.last_opp_from ?? null,
          last_opp_to: mv.last_opp_to ?? null,
          last_opp_san: mv.last_opp_san ?? null,
          opening: ga.opening ?? null,
          eco: ga.eco ?? null,
          error_type: mv.errorType ?? null,
          blame_weight: mv.blameWeight ?? null,
          state_before: mv.stateBefore ?? null,
          time_state: mv.timeState ?? null,
          clock_remaining: mv.clockRemaining ?? null,
          spent_seconds: mv.spentSeconds ?? null,
          game_url: ga.game_url ?? null,
          // Maia fields: null until enriched below.
          p_mine_plays_best_sf: null,
          p_target_plays_best_sf: null,
          p_maia_mine_top: null,
          p_maia_target_top: null,
          drill_value: null,
          priority_score: null,
          avoidable: null,
        });
      }
    }
  }

  // ── Maia enrichment ─────────────────────────────────────────────────────────
  // Cap to worst CADUTE_MAIA_CAP by cp_loss, then enrich, then write back.
  const maiaEnabled = currentRating != null && currentRating > 0;
  if (maiaEnabled && exampleCandidates.length > 0) {
    // Sort by cp_loss desc to find the worst positions.
    const sorted = [...exampleCandidates]
      .map((c, idx) => ({ idx, cp_loss: c.cp_loss }))
      .sort((a, b) => b.cp_loss - a.cp_loss)
      .slice(0, CADUTE_MAIA_CAP);

    const positionsForMaia = sorted.map((s) => ({
      fen_before: exampleCandidates[s.idx].fen_before,
      best_uci: exampleCandidates[s.idx].best_uci,
      phase: exampleCandidates[s.idx].phase,
      ply: exampleCandidates[s.idx].ply,
    }));

    // enrichWithMaia never throws: returns empty map on failure.
    const maiaMap = await enrichWithMaia(positionsForMaia, currentRating, targetRating);

    // Write Maia fields back to the original candidates.
    for (let j = 0; j < sorted.length; j++) {
      const fields = maiaMap.get(j);
      if (!fields) continue;
      const candidate = exampleCandidates[sorted[j].idx];
      candidate.p_mine_plays_best_sf = fields.p_mine_plays_best_sf;
      candidate.p_target_plays_best_sf = fields.p_target_plays_best_sf;
      candidate.p_maia_mine_top = fields.p_maia_mine_top;
      candidate.p_maia_target_top = fields.p_maia_target_top;
      // Overwrite Stockfish proxy with true Maia difficulty.
      candidate.move_difficulty = fields.move_difficulty;
      candidate.drill_value = fields.drill_value;
      candidate.priority_score = fields.priority_score;
      candidate.avoidable = fields.avoidable;
    }
  }

  // ── MaiaWeighted aggregates ──────────────────────────────────────────────────
  // Computed on all error candidates that have priority_score != null (Maia ran).
  let maiaWeighted: MaiaWeighted | null = null;
  {
    const scored = exampleCandidates.filter((c) => c.priority_score != null);
    if (scored.length > 0) {
      let avoidableCount = 0;
      let unavoidableCount = 0;
      let minePctSum = 0;
      let targetPctSum = 0;
      const byPhaseAv: Record<string, { errors: number; avoidable: number }> = {};

      for (const c of scored) {
        if (c.avoidable === true) avoidableCount++;
        if (
          c.p_target_plays_best_sf != null &&
          c.p_target_plays_best_sf < 0.5
        ) {
          unavoidableCount++;
        }
        minePctSum += (c.p_mine_plays_best_sf ?? 0) * 100;
        targetPctSum += (c.p_target_plays_best_sf ?? 0) * 100;

        // by_phase_avoidable uses the italian phase label already on PositionExample.
        const ph = c.phase ?? "mediogioco";
        if (!byPhaseAv[ph]) byPhaseAv[ph] = { errors: 0, avoidable: 0 };
        byPhaseAv[ph].errors++;
        if (c.avoidable === true) byPhaseAv[ph].avoidable++;
      }

      // ── spent_vs_avoidable ────────────────────────────────────────────────
      // Candidates: priority_score != null (already true for all in `scored`)
      // AND spent_seconds != null.
      const BUCKETS: { key: string; bucket: string; min: number; max: number }[] = [
        { key: "lt_5s",  bucket: "< 5 s",   min: 0,  max: 5 },
        { key: "5_15s",  bucket: "5-15 s",  min: 5,  max: 15 },
        { key: "15_30s", bucket: "15-30 s", min: 15, max: 30 },
        { key: "30_60s", bucket: "30-60 s", min: 30, max: 60 },
        { key: "gt_60s", bucket: "> 60 s",  min: 60, max: Infinity },
      ];
      const bucketAcc: Map<string, { errors: number; avoidable: number }> = new Map();

      for (const c of scored) {
        if (c.spent_seconds == null) continue;
        const s = c.spent_seconds;
        const b = BUCKETS.find((bk) => s >= bk.min && s < bk.max);
        if (!b) continue;
        if (!bucketAcc.has(b.key)) bucketAcc.set(b.key, { errors: 0, avoidable: 0 });
        const ba = bucketAcc.get(b.key)!;
        ba.errors++;
        if (c.avoidable === true) ba.avoidable++;
      }

      // Emit only non-empty buckets, preserving natural order (lt_5s first).
      const spent_vs_avoidable = BUCKETS.filter((b) => bucketAcc.has(b.key)).map((b) => ({
        key: b.key,
        bucket: b.bucket,
        errors: bucketAcc.get(b.key)!.errors,
        avoidable: bucketAcc.get(b.key)!.avoidable,
      }));

      const n = scored.length;
      const mine_pct = minePctSum / n;
      const target_pct = targetPctSum / n;
      maiaWeighted = {
        errors_scored: n,
        avoidable: avoidableCount,
        unavoidable: unavoidableCount,
        mine_pct,
        target_pct,
        gap_pct: target_pct - mine_pct,
        avoidable_share: n > 0 ? avoidableCount / n : 0,
        by_phase_avoidable: byPhaseAv,
        spent_vs_avoidable,
      };
    }
  }

  // ── Repertorio: conta errors/avoidable dalle mosse-errore post-Maia ─────────
  // exampleCandidates sono ora completamente arricchiti (Maia se disponibile).
  // Match per gameKey: ogni candidate porta l'eco/opening/color della sua partita,
  // che corrispondono esattamente alla chiave nel repertoireAcc.
  for (const c of exampleCandidates) {
    const rawOpening = c.opening ?? null;
    const rawEco = c.eco ?? null;
    const recognized =
      (rawOpening != null && rawOpening !== "Unknown") ||
      (rawEco != null && rawEco !== "??");
    const ecoKey = recognized ? (rawEco ?? "??") : "??";
    const openingKey = recognized ? (rawOpening ?? "Unknown") : "Apertura non riconosciuta";
    const repertoireKey = `${ecoKey}|${openingKey}|${c.color}`;
    const rRow = repertoireAcc.get(repertoireKey);
    if (!rRow) continue; // partita non in finestra analizzata, skip
    rRow.errors++;
    if (c.avoidable === true) rRow.avoidable++;
  }

  // Costruisce le RepertoireRow finali.
  const REPERTOIRE_TOP = 10;
  const repertoireRows: RepertoireRow[] = [];
  for (const [, rRow] of repertoireAcc) {
    repertoireRows.push({
      eco: rRow.eco,
      opening: rRow.opening,
      my_color: rRow.my_color,
      games: rRow.games,
      wins: rRow.wins,
      win_rate: rRow.games >= 4 ? rRow.wins / rRow.games : null,
      avg_acpl: rRow.movesTotal > 0 ? rRow.cpLossSum / rRow.movesTotal : 0,
      errors: rRow.errors,
      avoidable: rRow.avoidable,
      recognized: rRow.recognized,
    });
  }

  // Separa riconosciute da non-riconosciute.
  const recognizedRows = repertoireRows
    .filter((r) => r.recognized)
    .sort((a, b) =>
      b.avoidable !== a.avoidable
        ? b.avoidable - a.avoidable
        : b.errors !== a.errors
          ? b.errors - a.errors
          : b.games - a.games,
    )
    .slice(0, REPERTOIRE_TOP);

  const unknownRows = repertoireRows
    .filter((r) => !r.recognized)
    .sort((a, b) => b.games - a.games);

  const repertoire: RepertoireRow[] = [...recognizedRows, ...unknownRows];

  // ── Normalizzazioni ──────────────────────────────────────────────────────────
  for (const phase of ["opening", "middlegame", "endgame"] as const) {
    const p = byPhase[phase];
    p.blunder_pct = p.moves > 0 ? (p.blunders / p.moves) * 100 : 0;
    p.mistake_pct = p.moves > 0 ? (p.mistakes / p.moves) * 100 : 0;
    p.inaccuracy_pct = p.moves > 0 ? (p.inaccuracies / p.moves) * 100 : 0;
    p.avg_cp_loss = p.moves > 0 ? phaseCpLossSum[phase] / p.moves : 0;
  }

  const finalByTimeClass: Record<string, TimeClassAgg> = {};
  for (const tc of Object.keys(byTimeClass)) {
    const a = byTimeClass[tc];
    finalByTimeClass[tc] = {
      games: a.games,
      wins: a.wins,
      draws: a.draws,
      losses: a.losses,
      win_rate: a.games > 0 ? a.wins / a.games : 0,
      avg_cp_loss: a.moves > 0 ? a.cpLossSum / a.moves : 0,
    };
  }

  const finalByColor: { white: ColorAgg; black: ColorAgg } = {
    white: {
      games: byColor.white.games,
      wins: byColor.white.wins,
      draws: byColor.white.draws,
      losses: byColor.white.losses,
      win_rate: byColor.white.games > 0 ? byColor.white.wins / byColor.white.games : 0,
      avg_cp_loss: byColor.white.moves > 0 ? byColor.white.cpLossSum / byColor.white.moves : 0,
      blunder_pct: byColor.white.moves > 0 ? (byColor.white.blunders / byColor.white.moves) * 100 : 0,
    },
    black: {
      games: byColor.black.games,
      wins: byColor.black.wins,
      draws: byColor.black.draws,
      losses: byColor.black.losses,
      win_rate: byColor.black.games > 0 ? byColor.black.wins / byColor.black.games : 0,
      avg_cp_loss: byColor.black.moves > 0 ? byColor.black.cpLossSum / byColor.black.moves : 0,
      blunder_pct: byColor.black.moves > 0 ? (byColor.black.blunders / byColor.black.moves) * 100 : 0,
    },
  };

  // Esempi finali: i peggiori per cp_loss, max 2 per partita (varieta').
  exampleCandidates.sort((a, b) => b.cp_loss - a.cp_loss);
  const perGame: Record<string, number> = {};
  const examples: PositionExample[] = [];
  for (const c of exampleCandidates) {
    if (examples.length >= MAX_COACH_EXAMPLES) break;
    if ((perGame[c.gameKey] ?? 0) >= 2) continue;
    perGame[c.gameKey] = (perGame[c.gameKey] ?? 0) + 1;
    const { gameKey: _gameKey, ...ex } = c;
    examples.push(ex);
  }

  // Cadute: galleria piu' ampia, ordinate per trainability desc, max 4 per partita.
  // Score = drill_value * (blame_weight * cp_loss) when Maia ran (drill_value != null),
  // else fallback to blame_weight * cp_loss. This surfaces Maia-ranked positions at
  // the top of the gallery, while positions without Maia data still participate.
  // priority_score 0 positions are NOT excluded here — they stay in the gallery
  // so the player sees their worst moments; Maia weighting naturally deprioritises them.
  const caduteByTrainability = [...exampleCandidates].sort((a, b) => {
    const impactA = (a.blame_weight ?? 1.0) * a.cp_loss;
    const impactB = (b.blame_weight ?? 1.0) * b.cp_loss;
    const scoreA = a.drill_value != null ? a.drill_value * impactA : impactA;
    const scoreB = b.drill_value != null ? b.drill_value * impactB : impactB;
    return scoreB - scoreA;
  });
  const perGameCadute: Record<string, number> = {};
  const cadute: PositionExample[] = [];
  for (const c of caduteByTrainability) {
    if (cadute.length >= CADUTE_LIMIT) break;
    if ((perGameCadute[c.gameKey] ?? 0) >= 4) continue;
    perGameCadute[c.gameKey] = (perGameCadute[c.gameKey] ?? 0) + 1;
    const { gameKey: _gk, ...ex } = c;
    cadute.push(ex);
  }

  // ── Anchors (ex-Weaknesses) ───────────────────────────────────────────────
  // Group by errorType, exclude "in_lost_position".
  const anchorAcc: Map<string, {
    cpLossSum: number;
    weightedScoreSum: number;
    games: Set<string>;
    count: number;
    count_avoidable: number;
    // Per-anchor Maia averages: mine_pct / target_pct from p_maia_mine_top / p_maia_target_top.
    // Only positions where Maia ran (p_maia_mine_top != null) contribute.
    maia_mine_sum: number;
    maia_target_sum: number;
    maia_n: number;
    candidates: Array<{ example: PositionExample & { gameKey: string }; score: number }>;
  }> = new Map();

  for (const c of exampleCandidates) {
    const et = c.error_type;
    if (!et || et === "in_lost_position") continue;

    // Exclude priority_score 0 from weighted scoring (trivial / opening / target also misses).
    const priorityOk = c.priority_score == null || c.priority_score > 0;
    const impact = c.cp_loss * (c.blame_weight ?? 1.0);

    // Weighted score: drill_value * impact if Maia available; else blameWeight * cp_loss fallback.
    const drillWeight =
      c.drill_value != null && priorityOk
        ? c.drill_value * impact
        : priorityOk
          ? impact
          : 0;

    if (!anchorAcc.has(et)) {
      anchorAcc.set(et, { cpLossSum: 0, weightedScoreSum: 0, games: new Set(), count: 0, count_avoidable: 0, maia_mine_sum: 0, maia_target_sum: 0, maia_n: 0, candidates: [] });
    }
    const acc = anchorAcc.get(et)!;
    acc.count++;
    // count_avoidable: errors where Maia says the player at their level could avoid this.
    // priority_score >= 2 means avoidable (2=avoidable, 3=money).
    if (c.priority_score != null && c.priority_score >= 2) acc.count_avoidable++;
    acc.cpLossSum += c.cp_loss;
    acc.weightedScoreSum += drillWeight;
    acc.games.add(c.gameKey);
    // Accumulate per-anchor Maia top-policy for mine_pct / target_pct.
    if (c.p_maia_mine_top != null && c.p_maia_target_top != null) {
      acc.maia_mine_sum += c.p_maia_mine_top;
      acc.maia_target_sum += c.p_maia_target_top;
      acc.maia_n++;
    }
    acc.candidates.push({ example: c, score: drillWeight });
  }

  // Total errors (excluding in_lost_position) for share_of_errors.
  let totalErrors = 0;
  for (const [, v] of anchorAcc) totalErrors += v.count;

  const anchors: Anchor[] = [];
  for (const [type, data] of anchorAcc) {
    const meta = WEAKNESS_META[type];
    if (!meta) continue;
    // Pick top 3 exemplars by weighted drill score.
    data.candidates.sort((a, b) => b.score - a.score);
    const exemplars: PositionExample[] = data.candidates.slice(0, 3).map((c) => {
      const { gameKey: _gk, ...ex } = c.example;
      return ex;
    });
    const share = totalErrors > 0 ? data.count / totalErrors : 0;
    // rating_upside: round(share * 100) capped to [0..60].
    const rawUpside = Math.round(share * 100);
    const rating_upside = rawUpside > 0 ? Math.min(rawUpside, 60) : null;
    // FIX D: normalize mine_pct / target_pct to 0..100 (same scale as maia_weighted).
    // These are averages of p_maia_mine_top / p_maia_target_top which are 0..1 fractions
    // from the ONNX policy head. Without *100, Math.round(mine_pct) would always be 0 or 1
    // when Onda 3 wires up the anchor-trail.
    //
    // IMPORTANT — semantic note: these values represent average top-policy obviousness
    // (0..100) for a player at mine/target ELO. This is a PROPERTY OF THE POSITIONS in
    // this anchor type, NOT a progress indicator. The value does NOT decrease as the
    // user improves (a hung-piece position will always be 90%+ obvious at 1500). The
    // signal of "anchor shrinking over time" lives in count/games_analyzed (the
    // milestone/trend code). Use mine_pct/target_pct only as STATIC CONTEXT.
    const mine_pct = data.maia_n > 0 ? (data.maia_mine_sum / data.maia_n) * 100 : null;
    const target_pct = data.maia_n > 0 ? (data.maia_target_sum / data.maia_n) * 100 : null;
    anchors.push({
      type,
      ...meta,
      count: data.count,
      count_avoidable: data.count_avoidable,
      share_of_errors: share,
      games_with: data.games.size,
      avg_cp_loss: data.count > 0 ? data.cpLossSum / data.count : 0,
      rating_upside,
      weighted_score: data.weightedScoreSum,
      mine_pct,
      target_pct,
      exemplars,
    });
  }
  anchors.sort((a, b) => b.weighted_score - a.weighted_score);

  // ── trend_now per Anchor (§2.1 BUILD.md) ─────────────────────────────────
  // Two 28-day windows relative to the most recent game date in the candidate
  // pool. "recent" = [lastDate - 27d .. lastDate]; "prior" = [lastDate - 55d .. lastDate - 28d].
  // We use played_at (the game timestamp on each PositionExample).
  {
    // Find the most recent game date across all candidates.
    let maxDateMs = 0;
    for (const c of exampleCandidates) {
      if (c.played_at) {
        const t = Date.parse(c.played_at);
        if (!isNaN(t) && t > maxDateMs) maxDateMs = t;
      }
    }

    if (maxDateMs > 0) {
      const MS_PER_DAY = 86_400_000;
      const recentEnd = maxDateMs;
      const recentStart = maxDateMs - 27 * MS_PER_DAY;   // [maxDate-27d .. maxDate]
      const priorEnd   = maxDateMs - 28 * MS_PER_DAY;    // [maxDate-55d .. maxDate-28d]
      const priorStart = maxDateMs - 55 * MS_PER_DAY;

      // Per each anchor type, collect recent/prior error counts and distinct game keys.
      const trendAcc: Map<string, {
        recent_n: number; prior_n: number;
        recent_games: Set<string>; prior_games: Set<string>;
        target_pct_sum: number; target_pct_n: number;
      }> = new Map();

      for (const c of exampleCandidates) {
        const et = c.error_type;
        if (!et || et === "in_lost_position") continue;
        if (!WEAKNESS_META[et]) continue; // not a tracked anchor type
        if (!c.played_at) continue;
        const t = Date.parse(c.played_at);
        if (isNaN(t)) continue;

        if (!trendAcc.has(et)) {
          trendAcc.set(et, {
            recent_n: 0, prior_n: 0,
            recent_games: new Set(), prior_games: new Set(),
            target_pct_sum: 0, target_pct_n: 0,
          });
        }
        const ta = trendAcc.get(et)!;

        // Accumulate target_pct from Maia (all positions, regardless of window).
        if (c.p_maia_target_top != null) {
          ta.target_pct_sum += c.p_maia_target_top;
          ta.target_pct_n++;
        }

        if (t >= recentStart && t <= recentEnd) {
          ta.recent_n++;
          ta.recent_games.add(c.gameKey);
        } else if (t >= priorStart && t <= priorEnd) {
          ta.prior_n++;
          ta.prior_games.add(c.gameKey);
        }
      }

      // Denominator: ALL analyzed games (including zero-error games) in each window.
      // We use allAnalyzedPlayedAt collected above — this gives an honest
      // errors-per-game rate, not inflated by counting only games with errors.
      let recentGamesCount = 0;
      let priorGamesCount = 0;
      for (const playedAt of allAnalyzedPlayedAt) {
        const t = Date.parse(playedAt);
        if (isNaN(t)) continue;
        if (t >= recentStart && t <= recentEnd) recentGamesCount++;
        else if (t >= priorStart && t <= priorEnd) priorGamesCount++;
      }

      // Attach trend_now to each anchor.
      for (const anchor of anchors) {
        const ta = trendAcc.get(anchor.type);
        if (!ta) {
          anchor.trend_now = null;
          continue;
        }

        const recent_games = recentGamesCount;
        const prior_games  = priorGamesCount;

        const recent_per_game =
          recent_games > 0 ? ta.recent_n / recent_games : null;
        const prior_per_game =
          prior_games > 0 ? ta.prior_n / prior_games : null;

        // FIX D: normalize to 0..100 (same scale as Anchor.mine_pct / target_pct).
        const target_pct =
          ta.target_pct_n > 0 ? (ta.target_pct_sum / ta.target_pct_n) * 100 : null;

        // Direction.
        let direction: AnchorTrendNow["direction"] = "stable";
        if (recent_per_game != null && prior_per_game != null) {
          const delta = recent_per_game - prior_per_game;
          const threshold = 0.05; // at least 5% change per game
          if (delta < -threshold) direction = "improving";
          else if (delta > threshold) direction = "worsening";
        }

        // Confidence: based on min(recent_n, prior_n) and n. games per window.
        const minN = Math.min(ta.recent_n, ta.prior_n);
        const minGames = Math.min(recent_games, prior_games);
        let confidence: AnchorTrendNow["confidence"];
        if (minN >= 5 && minGames >= 5) confidence = "high";
        else if (minN >= 2 && minGames >= 2) confidence = "medium";
        else confidence = "low";

        // Guard: null if both windows are empty (no data at all).
        if (ta.recent_n === 0 && ta.prior_n === 0) {
          anchor.trend_now = null;
          continue;
        }

        anchor.trend_now = {
          recent_per_game,
          prior_per_game,
          recent_n: ta.recent_n,
          prior_n: ta.prior_n,
          recent_games,
          prior_games,
          target_pct,
          direction,
          confidence,
        };
      }
    }
  }

  // TODO: waiting_moves — "posizioni di attesa" quando p_maia_mine_top < 0.20. (M3)
  // TODO: strutture pedonali — cluster per natura posizionale. (M3)

  // ── Transfer aggregates (§7.3 BUILD.md) ──────────────────────────────────────
  // Computed from all motif_occurrences collected above. Returns undefined if no
  // occurrence data exists (old analysis files before this feature was added).
  const transfer = computeTransferAggregates(allMotifOccurrences);

  const out: Aggregates = {
    generated_at: new Date().toISOString(),
    games_analyzed: analyzedCount,
    player_moves_total: movesTotal,
    blunder_pct: movesTotal > 0 ? (blundersTotal / movesTotal) * 100 : 0,
    mistake_pct: movesTotal > 0 ? (mistakesTotal / movesTotal) * 100 : 0,
    inaccuracy_pct: movesTotal > 0 ? (inaccTotal / movesTotal) * 100 : 0,
    avg_cp_loss: movesTotal > 0 ? cpLossSum / movesTotal : 0,
    by_phase: byPhase,
    by_time_class: finalByTimeClass,
    by_color: finalByColor,
    examples,
    cadute,
    anchors,
    weaknesses: anchors, // alias, same array reference
    maia_weighted: maiaWeighted,
    repertoire: repertoire.length > 0 ? repertoire : undefined,
    transfer,
  };

  await uploadJson(quadernoPath(userId, "aggregates.json"), out);
  return out;
}

// Quadernopath helper re-export for storage.ts isolation.
export { analysisPath };
