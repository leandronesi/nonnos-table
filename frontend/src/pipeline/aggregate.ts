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
import {
  MAIA_POLICY_SEMANTICS,
  assessMaiaDomain,
  classifyMaiaPriority,
  scoreMaiaPolicies,
  summarizeMaiaCoverage,
} from "./maia/policySemantics";
import type {
  MaiaCoverage,
  MaiaDomainAssessment,
  MaiaDomainReason,
  MaiaDomainStatus,
  MaiaPolicyMetrics,
  MaiaPositionOutcome,
  MaiaReasonCode,
} from "./maia/policySemantics";
import type { ErrorEvidence, ErrorSignal } from "./errorSemantics";
import { FREE_GAME_CAP, MAX_COACH_EXAMPLES, CADUTE_LIMIT, CADUTE_MAIA_CAP } from "./config";
import type { AnalyzedTimeClass } from "./config";
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
  /** Chess.com UUID reale della partita sorgente. */
  source_game_id: string;
  /** Identita' stabile della decisione, indipendente dall'ordinamento UI. */
  position_id: string;
  played_at?: string;
  time_class?: string;
  color: "white" | "black";
  phase: string;
  ply: number;
  san: string;
  played_uci: string;
  best_uci: string | null;
  /** Set accettabile OSSERVATO nelle linee MultiPV (best inclusa). */
  acceptable_observed_uci?: string[];
  /** Numero di linee MultiPV disponibili al momento dell'analisi. */
  acceptable_set_multipv?: number;
  /** Sempre false finche' non enumeriamo tutte le mosse legali con Stockfish. */
  acceptable_moves_complete?: boolean;
  cp_loss: number;
  score_before_cp: number;
  score_after_cp: number;
  fen_before: string;
  category: "blunder" | "mistake";
  /** Motif tattico v1 (es. "pezzo_in_presa"). null se non rilevato. */
  motif?: string | null;
  /**
   * @deprecated Alias legacy di stockfish_choice_gap. Non viene sovrascritto da Maia.
   */
  move_difficulty?: number | null;
  /** Gap normalizzato best-second Stockfish (0..1), dalle linee MultiPV osservate. */
  stockfish_choice_gap?: number | null;
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
  error_signals?: ErrorSignal[];
  error_evidence?: ErrorEvidence | null;
  legacy_error_type?: string | null;
  trainability_weight?: number | null;
  blame_weight?: number | null;
  state_before?: string | null;
  time_state?: string | null;
  clock_remaining?: number | null;
  /** Secondi spesi dal player su questa mossa (da PGN [%clk]). null se assente. */
  spent_seconds?: number | null;
  /** URL Chess.com della partita (es. "https://www.chess.com/game/live/12345"). null se assente. */
  game_url?: string | null;
  // ── Campi Maia (popolati solo se engine disponibile) ──────────────────────
  /** @deprecated Massa policy raw della sola best Stockfish; non e' una frequenza umana. */
  p_mine_plays_best_sf?: number | null;
  /** @deprecated Massa policy raw della sola best Stockfish; non e' una frequenza umana. */
  p_target_plays_best_sf?: number | null;
  /** Top-policy raw del mio livello; contesto, non frequenza umana calibrata. */
  p_maia_mine_top?: number | null;
  /** Top-policy raw del target; contesto, non frequenza umana calibrata. */
  p_maia_target_top?: number | null;
  /** Massa policy raw assegnata alla mossa realmente giocata. */
  maia_mine_played_policy?: number | null;
  maia_target_played_policy?: number | null;
  /** Massa policy raw sommata su tutte le mosse accettabili. */
  maia_mine_acceptable_observed_policy?: number | null;
  maia_target_acceptable_observed_policy?: number | null;
  /** 1 - massa target osservata; separata dal gap Stockfish. */
  maia_target_acceptable_observed_difficulty?: number | null;
  /** Stato esplicito: uno 0 reale non viene confuso con Maia non eseguita. */
  maia_status?: MaiaPositionOutcome["status"];
  maia_reason_code?: MaiaReasonCode;
  maia_policy_semantics?: typeof MAIA_POLICY_SEMANTICS;
  maia_domain_status?: MaiaDomainStatus;
  maia_domain_reason?: MaiaDomainReason;
  /** Supporto della policy al livello corrente: unica semantica di avoidable. */
  avoidable_at_current?: boolean | null;
  /** La policy target supporta le mosse buone piu' di quella corrente. */
  target_relevant?: boolean | null;
  /** Posizione utile al training (current-supported o target-relevant, fuori guard). */
  trainable?: boolean | null;
  /** Peso non-negativo: supporto current + lift positivo target, capped a 1. */
  training_priority_weight?: number | null;
  /**
   * drill_value = target - mine sulla massa delle mosse accettabili.
   * E' un confronto relativo di policy, non una percentuale di umani.
   */
  drill_value?: number | null;
  /**
   * 3=forte lift target / 2=supporto current o target / 1=segnale debole / 0=skip.
   * null se Maia non disponibile.
   */
  priority_score?: number | null;
  /** @deprecated Alias di avoidable_at_current, non di priority_score >= 2. */
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
  /** Mosse con supporto della policy al livello corrente. */
  avoidable: number;
  /** Posizioni scored dove il dominio consente il claim current-avoidable. */
  avoidable_at_current_known_positions: number;
  /** Posizioni pertinenti al target, anche se non evitabili al livello corrente. */
  target_relevant: number;
  /** Posizioni marcate trainable dal ranking Maia. */
  trainable: number;
  /** @deprecated Conteggio reason_code=target_policy_weak; non significa "inevitabile". */
  unavoidable: number;
  /** @deprecated Alias della massa mine osservata; non e' una frequenza umana. */
  mine_pct: number;
  /** @deprecated Alias della massa target osservata; non e' una frequenza umana. */
  target_pct: number;
  /** Medie esplicite delle masse policy sulle mosse accettabili (0..100). */
  mine_acceptable_observed_policy_pct: number;
  target_acceptable_observed_policy_pct: number;
  /** Medie delle masse policy assegnate alla mossa giocata (0..100). */
  mine_played_policy_pct: number;
  target_played_policy_pct: number;
  /** Dichiarazione machine-readable: questi valori non sono frequenze calibrate. */
  policy_semantics: typeof MAIA_POLICY_SEMANTICS;
  /** @deprecated Delta in punti di massa policy osservata, non frequenza. */
  gap_pct: number;
  /** avoidable / errors_scored (0..1). Frazione di errori su cui vale lavorare. */
  avoidable_share: number;
  avoidable_at_current_share: number | null;
  target_relevant_share: number;
  trainable_share: number;
  /**
   * Per fase ("apertura"/"mediogioco"/"finale") -> { errors, avoidable }.
   * Usa le etichette italiane come in PositionExample.phase.
   */
  by_phase_avoidable: Record<string, { errors: number; avoidable: number }>;
  /**
   * Cross "tempo speso x evitabilita'": distribuisce gli errori-con-Maia per
   * bucket di spent_seconds e mostra quanti erano avoidable in ciascun bucket.
   *
   * Descrive la co-occorrenza fra tempo speso e supporto current; non attribuisce
   * al tempo la causa dell'errore.
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
   * Number of errors supported by Maia at the current level (avoidable_at_current).
   * 0 if Maia did not run (all priority_score null).
   * Subset of `count` — does NOT replace it.
   */
  count_avoidable: number;
  share_of_errors: number;
  /** Quota dello score pesato totale fra le ancore (0..1), non punti Elo. */
  relative_priority: number;
  games_with: number;
  avg_cp_loss: number;
  /**
   * @deprecated Campo legacy. Sempre null: non esiste un modello Elo validato.
   */
  rating_upside: number | null;
  /**
   * Punteggio ordinamento: se Maia disponibile, training_priority_weight * impact;
   * altrimenti Σ(blameWeight * cp_loss). Escluse posizioni priority_score 0.
   */
  weighted_score: number;
  /** @deprecated Alias della massa observed current, non frequenza. */
  mine_pct: number | null;
  /** @deprecated Alias della massa observed target, non frequenza. */
  target_pct: number | null;
  mine_acceptable_observed_policy_pct: number | null;
  target_acceptable_observed_policy_pct: number | null;
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
 * La colonna guida legacy e' `avoidable`: conta gli errori in cui la policy
 * corrente assegna massa sufficiente alle mosse buone osservate. E' una soglia
 * euristica su policy raw, non la prova che il giocatore avrebbe evitato l'errore.
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
   * Errori con avoidable_at_current===true secondo la soglia policy esplicita.
   * Il nome e' legacy: il valore non e' una frequenza umana calibrata.
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
  /** Scope effettivo della lettura; assente solo nei vecchi snapshot. */
  analysis_scope?: {
    time_class: AnalyzedTimeClass;
    game_cap: number;
    games_analyzed: number;
  };
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
  /** Copertura e motivi dei fallback Maia su tutte le mosse-errore eleggibili. */
  maia_coverage?: MaiaCoverage;
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
  left_winning_band: {
    label_it: "Uscita dalla fascia winning",
    meaning_it: "La valutazione era sopra la soglia winning ed e' scesa sotto quella soglia; puo' restare comunque positiva.",
    action_it: "Rivedi quali semplificazioni o controlli mantenevano il vantaggio.",
    category: "tecnica",
  },
  clock_pressure: {
    label_it: "Errore con poco tempo",
    meaning_it: "L'errore e' avvenuto sotto la soglia di pressione del clock; il dato descrive il contesto, non la causa.",
    action_it: "Osserva dove hai consumato il tempo prima di questa posizione.",
    category: "timing",
  },
  fast_decision: {
    label_it: "Decisione rapida",
    meaning_it: "La mossa-errore e' stata giocata in tre secondi o meno; non sappiamo dal solo clock se la velocita' l'abbia causata.",
    action_it: "Ripeti la posizione senza fretta e confronta il processo decisionale.",
    category: "timing",
  },
  narrow_choice_after_long_think: {
    label_it: "Scelta stretta dopo riflessione",
    meaning_it: "Hai riflettuto a lungo e le linee MultiPV osservate avevano un divario netto; non implica da solo una tattica mancata.",
    action_it: "Ricostruisci candidate e varianti considerate durante la partita.",
    category: "tattica",
  },
  unclassified_error: {
    label_it: "Errore da classificare",
    meaning_it: "La perdita e' reale, ma i segnali disponibili non sostengono una causa piu' specifica.",
    action_it: "Rivedi la posizione e annota cosa avevi calcolato prima di muovere.",
    category: "comportamento",
  },
  careless: {
    label_it: "Errore non classificato (storico)",
    meaning_it: "Categoria legacy usata quando mancava una spiegazione supportata; non prova una disattenzione.",
    action_it: "Rianalizza la posizione con la nuova tassonomia fattuale.",
    category: "tattica",
  },
  hung_piece: {
    label_it: "Pezzi in presa",
    meaning_it: "Dopo la mossa il rilevatore geometrico trova un pezzo catturabile senza ricattura immediata.",
    action_it: "Controlla sempre le catture dell'avversario prima di muovere.",
    category: "tattica",
  },
  rushed: {
    label_it: "Decisione rapida (storico)",
    meaning_it: "Categoria legacy basata sul tempo speso; la velocita' da sola non dimostra la causa dell'errore.",
    action_it: "Confronta la stessa posizione con e senza limite di tempo.",
    category: "timing",
  },
  conversion: {
    label_it: "Vantaggio prima dell'errore (storico)",
    meaning_it: "Categoria legacy: indicava solo che eri sopra +1.5 prima della mossa, non che il vantaggio fosse davvero perso.",
    action_it: "Verifica se la valutazione e' uscita dalla fascia di vantaggio.",
    category: "tecnica",
  },
  zeitnot: {
    label_it: "Errore con poco tempo (storico)",
    meaning_it: "Categoria legacy per errori sotto la soglia clock; descrive il contesto, non una causa.",
    action_it: "Ricostruisci dove e' stato speso il tempo nella partita.",
    category: "timing",
  },
  missed_tactic: {
    label_it: "Divario MultiPV (storico)",
    meaning_it: "Categoria legacy inferita dal divario fra due linee; quel dato da solo non prova una tattica mancata.",
    action_it: "Cerca un motivo tattico verificabile prima di assegnare un tema.",
    category: "tattica",
  },
  hard_calc: {
    label_it: "Scelta stretta dopo riflessione (storico)",
    meaning_it: "Categoria legacy basata su tempo lungo e divario MultiPV; non identifica da sola la causa.",
    action_it: "Annota candidate e linee realmente calcolate.",
    category: "tattica",
  },
};

// ── Maia batch helper ─────────────────────────────────────────────────────────

const MAIA_CHUNK_SIZE = 24;

type MaiaFields =
  | (MaiaPolicyMetrics & {
      status: "scored";
      reason_code: MaiaReasonCode;
      priority_score: number;
      avoidable_at_current: boolean | null;
      target_relevant: boolean;
      trainable: boolean;
      training_priority_weight: number;
    })
  | {
      status: "skipped" | "unavailable";
      reason_code: "missing_acceptable_moves" | "model_unavailable";
    };

/**
 * Runs Maia on a list of error positions and returns MaiaFields per index.
 * Returns null map on any failure — callers must handle gracefully.
 */
async function enrichWithMaia(
  positions: Array<{
    fen_before: string;
    played_uci: string;
    best_uci: string | null;
    acceptable_observed_uci: string[];
    clock_remaining: number | null;
    time_class: string;
    phase: string;
    ply: number;
  }>,
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
    for (let i = 0; i < positions.length; i++) {
      const fen = positions[i].fen_before;
      // mine: eloSelf = eloOppo = currentRating
      fens.push(fen);
      eloSelfs.push(currentRating);
      eloOppos.push(currentRating);
      // target: eloSelf = eloOppo = targetRating
      fens.push(fen);
      eloSelfs.push(targetRating);
      eloOppos.push(targetRating);
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
      if (!mineResult || !targetResult) {
        result.set(i, { status: "unavailable", reason_code: "model_unavailable" });
        continue;
      }

      const policyMine = mineResult.policy;
      const policyTarget = targetResult.policy;
      const metrics = scoreMaiaPolicies({
        policyMine,
        policyTarget,
        playedUci: positions[i].played_uci,
        bestUci: positions[i].best_uci,
        acceptableObservedUcis: positions[i].acceptable_observed_uci,
      });
      if (!metrics) {
        result.set(i, { status: "skipped", reason_code: "missing_acceptable_moves" });
        continue;
      }

      const domain = assessMaiaDomain({
        timeClass: positions[i].time_class,
        clockRemaining: positions[i].clock_remaining,
      });
      const priority = classifyMaiaPriority(metrics, positions[i].ply, {
        allowCurrentAvoidable: domain.current_avoidable_claim_allowed,
      });
      result.set(i, {
        status: "scored",
        ...metrics,
        ...priority,
      });
    }
  } catch (err) {
    // Graceful ma esplicito: ogni posizione selezionata riceve uno status.
    console.warn("[aggregate] Maia enrichment skipped:", err);
    for (let i = 0; i < positions.length; i++) {
      if (!result.has(i)) {
        result.set(i, { status: "unavailable", reason_code: "model_unavailable" });
      }
    }
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
 * @param goalTimeClass Unica cadenza inclusa (rapid O blitz).
 * @param currentRating Player's current ELO (used for Maia enrichment). null = skip Maia.
 * @param targetRating  Player's target ELO (used for Maia enrichment). Defaults to
 *                      currentRating + 200 if not provided; ignored if currentRating null.
 */
export async function computeAggregates(
  userId: string,
  goalTimeClass: AnalyzedTimeClass,
  currentRating: number | null = null,
  targetRating: number = (currentRating ?? 1200) + 200,
  guardWrite?: () => Promise<void>,
): Promise<Aggregates> {
  // Una sola cadenza per lettura: rating, Maia e gestione tempo devono riferirsi
  // allo stesso corpus. Il cap viene applicato DOPO l'eq sulla goal_time_class.
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id,chess_com_uuid,time_class,color,result,analysis_path,analysis_status")
    .eq("user_id", userId)
    .eq("analysis_status", "done")
    .eq("time_class", goalTimeClass)
    .order("played_at", { ascending: false })
    .limit(FREE_GAME_CAP);

  if (gamesError) {
    throw new Error(`aggregate_games_select_failed:${gamesError.message}`);
  }

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

    // Defensive check against a stale/mis-addressed analysis blob.
    if (g.time_class !== goalTimeClass) continue;
    if (ga.time_class && ga.time_class !== goalTimeClass) continue;

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
        const maiaDomain = assessMaiaDomain({
          timeClass: ga.time_class,
          clockRemaining: mv.clockRemaining ?? null,
        });
        exampleCandidates.push({
          gameKey: ga.chess_com_uuid,
          source_game_id: ga.chess_com_uuid,
          position_id: `${ga.chess_com_uuid}:${mv.ply}`,
          played_at: ga.played_at,
          time_class: ga.time_class,
          color: ga.color,
          phase: phaseIt(mv.phase),
          ply: mv.ply,
          san: mv.san,
          played_uci: mv.uci,
          best_uci: mv.bestMoveUci,
          acceptable_observed_uci:
            mv.acceptableObservedMoveUcis ?? (mv.bestMoveUci ? [mv.bestMoveUci] : []),
          acceptable_set_multipv:
            mv.acceptableSetMultiPv ?? (mv.bestMoveUci ? 1 : 0),
          acceptable_moves_complete: mv.acceptableMovesComplete ?? false,
          cp_loss: mv.cpLoss,
          score_before_cp: mv.scoreBeforeCp,
          score_after_cp: mv.scoreAfterCp,
          fen_before: mv.fenBefore,
          category: mv.category,
          motif: mv.motif ?? null,
          move_difficulty: mv.stockfishChoiceGap ?? mv.moveDifficulty ?? null,
          stockfish_choice_gap: mv.stockfishChoiceGap ?? mv.moveDifficulty ?? null,
          last_opp_from: mv.last_opp_from ?? null,
          last_opp_to: mv.last_opp_to ?? null,
          last_opp_san: mv.last_opp_san ?? null,
          opening: ga.opening ?? null,
          eco: ga.eco ?? null,
          error_type: mv.errorType ?? null,
          error_signals: mv.errorSignals ?? [],
          error_evidence: mv.errorEvidence ?? null,
          legacy_error_type: mv.legacyErrorType ?? null,
          trainability_weight: mv.trainabilityWeight ?? mv.blameWeight ?? null,
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
          maia_mine_played_policy: null,
          maia_target_played_policy: null,
          maia_mine_acceptable_observed_policy: null,
          maia_target_acceptable_observed_policy: null,
          maia_target_acceptable_observed_difficulty: null,
          drill_value: null,
          priority_score: null,
          avoidable: null,
          avoidable_at_current: null,
          target_relevant: null,
          trainable: null,
          training_priority_weight: null,
          maia_policy_semantics: MAIA_POLICY_SEMANTICS,
          maia_domain_status: maiaDomain.status,
          maia_domain_reason: maiaDomain.reason,
        });
      }
    }
  }

  if (analyzedCount === 0) {
    throw new Error(
      (games?.length ?? 0) > 0
        ? "aggregate_no_valid_analysis_json"
        : "aggregate_no_analyzed_games",
    );
  }

  // ── Maia enrichment ─────────────────────────────────────────────────────────
  // Cap to worst CADUTE_MAIA_CAP by cp_loss, then enrich, then write back.
  const maiaEnabled = currentRating != null && currentRating > 0;
  for (const candidate of exampleCandidates) {
    candidate.maia_status = maiaEnabled ? "not_scored" : "not_requested";
    candidate.maia_reason_code = maiaEnabled ? "outside_scoring_cap" : "rating_missing";
  }
  if (maiaEnabled && exampleCandidates.length > 0) {
    // Sort by cp_loss desc to find the worst positions.
    const sorted = [...exampleCandidates]
      .map((c, idx) => ({ idx, cp_loss: c.cp_loss }))
      .sort((a, b) => b.cp_loss - a.cp_loss)
      .slice(0, CADUTE_MAIA_CAP);

    const positionsForMaia = sorted.map((s) => ({
      fen_before: exampleCandidates[s.idx].fen_before,
      played_uci: exampleCandidates[s.idx].played_uci,
      best_uci: exampleCandidates[s.idx].best_uci,
      acceptable_observed_uci: exampleCandidates[s.idx].acceptable_observed_uci ?? [],
      clock_remaining: exampleCandidates[s.idx].clock_remaining ?? null,
      time_class: exampleCandidates[s.idx].time_class ?? "unknown",
      phase: exampleCandidates[s.idx].phase,
      ply: exampleCandidates[s.idx].ply,
    }));

    // enrichWithMaia never throws: returns empty map on failure.
    const maiaMap = await enrichWithMaia(positionsForMaia, currentRating, targetRating);

    // Write Maia fields back to the original candidates.
    for (let j = 0; j < sorted.length; j++) {
      const fields = maiaMap.get(j);
      const candidate = exampleCandidates[sorted[j].idx];
      if (!fields) {
        candidate.maia_status = "unavailable";
        candidate.maia_reason_code = "model_unavailable";
        continue;
      }
      candidate.maia_status = fields.status;
      candidate.maia_reason_code = fields.reason_code;
      if (fields.status !== "scored") continue;

      candidate.p_mine_plays_best_sf = fields.p_mine_plays_best_sf;
      candidate.p_target_plays_best_sf = fields.p_target_plays_best_sf;
      candidate.p_maia_mine_top = fields.p_maia_mine_top;
      candidate.p_maia_target_top = fields.p_maia_target_top;
      candidate.maia_mine_played_policy = fields.maia_mine_played_policy;
      candidate.maia_target_played_policy = fields.maia_target_played_policy;
      candidate.maia_mine_acceptable_observed_policy =
        fields.maia_mine_acceptable_observed_policy;
      candidate.maia_target_acceptable_observed_policy =
        fields.maia_target_acceptable_observed_policy;
      candidate.maia_target_acceptable_observed_difficulty =
        fields.maia_target_acceptable_observed_difficulty;
      candidate.drill_value = fields.drill_value;
      candidate.priority_score = fields.priority_score;
      candidate.avoidable_at_current = fields.avoidable_at_current;
      candidate.target_relevant = fields.target_relevant;
      candidate.trainable = fields.trainable;
      candidate.training_priority_weight = fields.training_priority_weight;
      candidate.avoidable = fields.avoidable_at_current;
    }
  }

  // ── MaiaWeighted aggregates ──────────────────────────────────────────────────
  // Computed on all error candidates that have priority_score != null (Maia ran).
  const maiaDomains: MaiaDomainAssessment[] = exampleCandidates.map((candidate) =>
    assessMaiaDomain({
      timeClass: candidate.time_class ?? "unknown",
      clockRemaining: candidate.clock_remaining ?? null,
    }),
  );
  const maiaCoverage = summarizeMaiaCoverage(
    exampleCandidates.map((candidate) => ({
      status: candidate.maia_status ?? "unavailable",
      reason_code: candidate.maia_reason_code ?? "model_unavailable",
    })),
    maiaEnabled,
    CADUTE_MAIA_CAP,
    maiaDomains,
  );

  let maiaWeighted: MaiaWeighted | null = null;
  {
    const scored = exampleCandidates.filter((c) => c.maia_status === "scored");
    if (scored.length > 0) {
      let avoidableCount = 0;
      let avoidableKnownCount = 0;
      let targetRelevantCount = 0;
      let trainableCount = 0;
      let unavoidableCount = 0;
      let minePctSum = 0;
      let targetPctSum = 0;
      let minePlayedPctSum = 0;
      let targetPlayedPctSum = 0;
      const byPhaseAv: Record<string, { errors: number; avoidable: number }> = {};

      for (const c of scored) {
        if (c.avoidable_at_current != null) avoidableKnownCount++;
        if (c.avoidable_at_current === true) avoidableCount++;
        if (c.target_relevant === true) targetRelevantCount++;
        if (c.trainable === true) trainableCount++;
        if (c.maia_reason_code === "target_policy_weak") unavoidableCount++;
        minePctSum += (c.maia_mine_acceptable_observed_policy ?? 0) * 100;
        targetPctSum += (c.maia_target_acceptable_observed_policy ?? 0) * 100;
        minePlayedPctSum += (c.maia_mine_played_policy ?? 0) * 100;
        targetPlayedPctSum += (c.maia_target_played_policy ?? 0) * 100;

        // by_phase_avoidable uses the italian phase label already on PositionExample.
        const ph = c.phase ?? "mediogioco";
        if (!byPhaseAv[ph]) byPhaseAv[ph] = { errors: 0, avoidable: 0 };
        byPhaseAv[ph].errors++;
        if (c.avoidable_at_current === true) byPhaseAv[ph].avoidable++;
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
        if (c.avoidable_at_current === true) ba.avoidable++;
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
      const mine_played_policy_pct = minePlayedPctSum / n;
      const target_played_policy_pct = targetPlayedPctSum / n;
      maiaWeighted = {
        errors_scored: n,
        avoidable: avoidableCount,
        avoidable_at_current_known_positions: avoidableKnownCount,
        target_relevant: targetRelevantCount,
        trainable: trainableCount,
        unavoidable: unavoidableCount,
        mine_pct,
        target_pct,
        mine_acceptable_observed_policy_pct: mine_pct,
        target_acceptable_observed_policy_pct: target_pct,
        mine_played_policy_pct,
        target_played_policy_pct,
        policy_semantics: MAIA_POLICY_SEMANTICS,
        gap_pct: target_pct - mine_pct,
        avoidable_share: n > 0 ? avoidableCount / n : 0,
        avoidable_at_current_share:
          avoidableKnownCount > 0 ? avoidableCount / avoidableKnownCount : null,
        target_relevant_share: n > 0 ? targetRelevantCount / n : 0,
        trainable_share: n > 0 ? trainableCount / n : 0,
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
  // Score = training_priority_weight * (trainability_weight * cp_loss) with Maia,
  // else fallback to blame_weight * cp_loss. This surfaces Maia-ranked positions at
  // the top of the gallery, while positions without Maia data still participate.
  // priority_score 0 positions are NOT excluded here — they stay in the gallery
  // so the player sees their worst moments; Maia weighting naturally deprioritises them.
  const caduteByTrainability = [...exampleCandidates].sort((a, b) => {
    const impactA = (a.blame_weight ?? 1.0) * a.cp_loss;
    const impactB = (b.blame_weight ?? 1.0) * b.cp_loss;
    const scoreA = a.training_priority_weight != null
      ? a.training_priority_weight * impactA
      : impactA;
    const scoreB = b.training_priority_weight != null
      ? b.training_priority_weight * impactB
      : impactB;
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
    // Per-anchor Maia averages sulla massa delle mosse accettabili.
    // Only positions where Maia ran contribute.
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

    // Current support and target lift contribute separately; equal mine/target
    // does not zero a position that is supported at the current level.
    const trainingWeight =
      c.training_priority_weight != null && priorityOk
        ? c.training_priority_weight * impact
        : priorityOk
          ? impact
          : 0;

    if (!anchorAcc.has(et)) {
      anchorAcc.set(et, { cpLossSum: 0, weightedScoreSum: 0, games: new Set(), count: 0, count_avoidable: 0, maia_mine_sum: 0, maia_target_sum: 0, maia_n: 0, candidates: [] });
    }
    const acc = anchorAcc.get(et)!;
    acc.count++;
    // Avoidable significa solo supporto al livello corrente; un forte lift del
    // target resta target_relevant/trainable ma non diventa evitabile oggi.
    if (c.avoidable_at_current === true) acc.count_avoidable++;
    acc.cpLossSum += c.cp_loss;
    acc.weightedScoreSum += trainingWeight;
    acc.games.add(c.gameKey);
    // Accumulate raw acceptable-policy mass (not calibrated human frequency).
    if (
      c.maia_mine_acceptable_observed_policy != null &&
      c.maia_target_acceptable_observed_policy != null
    ) {
      acc.maia_mine_sum += c.maia_mine_acceptable_observed_policy;
      acc.maia_target_sum += c.maia_target_acceptable_observed_policy;
      acc.maia_n++;
    }
    acc.candidates.push({ example: c, score: trainingWeight });
  }

  // Total errors (excluding in_lost_position) for share_of_errors.
  let totalErrors = 0;
  for (const [, v] of anchorAcc) totalErrors += v.count;
  let totalWeightedScore = 0;
  for (const [, v] of anchorAcc) totalWeightedScore += Math.max(0, v.weightedScoreSum);

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
    const relative_priority = totalWeightedScore > 0
      ? Math.max(0, data.weightedScoreSum) / totalWeightedScore
      : share;
    // Normalize the average raw policy mass over the OBSERVED acceptable set to
    // 0..100, matching maia_weighted. These aliases compare levels on the same
    // positions; they are neither calibrated human frequencies nor a progress
    // indicator. Progress lives in the error-rate trend.
    const mine_pct = data.maia_n > 0 ? (data.maia_mine_sum / data.maia_n) * 100 : null;
    const target_pct = data.maia_n > 0 ? (data.maia_target_sum / data.maia_n) * 100 : null;
    anchors.push({
      type,
      ...meta,
      count: data.count,
      count_avoidable: data.count_avoidable,
      share_of_errors: share,
      relative_priority,
      games_with: data.games.size,
      avg_cp_loss: data.count > 0 ? data.cpLossSum / data.count : 0,
      rating_upside: null,
      weighted_score: data.weightedScoreSum,
      mine_pct,
      target_pct,
      mine_acceptable_observed_policy_pct: mine_pct,
      target_acceptable_observed_policy_pct: target_pct,
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
        if (c.maia_target_acceptable_observed_policy != null) {
          ta.target_pct_sum += c.maia_target_acceptable_observed_policy;
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

  // waiting_moves is deliberately NOT precomputed here. It needs a Stockfish
  // pass per candidate move, and only the handful of positions that reach the
  // Sessione are ever reviewed, so precomputing it for every error candidate
  // would spend the browser's engine budget on moves nobody will see. It is
  // computed on demand in MomentReview, gated by shouldOfferWaitingMove()
  // (p_maia_mine_top < 0.20) with a graceful timeout. See session/waitingMove.ts.
  // TODO: strutture pedonali — cluster per natura posizionale. (M3)

  // ── Transfer aggregates (§7.3 BUILD.md) ──────────────────────────────────────
  // Computed from all motif_occurrences collected above. Returns undefined if no
  // occurrence data exists (old analysis files before this feature was added).
  const transfer = computeTransferAggregates(allMotifOccurrences);

  const out: Aggregates = {
    generated_at: new Date().toISOString(),
    analysis_scope: {
      time_class: goalTimeClass,
      game_cap: FREE_GAME_CAP,
      games_analyzed: analyzedCount,
    },
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
    maia_coverage: maiaCoverage,
    repertoire: repertoire.length > 0 ? repertoire : undefined,
    transfer,
  };

  await guardWrite?.();
  await uploadJson(quadernoPath(userId, "aggregates.json"), out);
  await guardWrite?.();
  return out;
}

// Quadernopath helper re-export for storage.ts isolation.
export { analysisPath };
