export type PrimaryErrorCategory =
  | "left_winning_band"
  | "clock_pressure"
  | "hung_piece"
  | "narrow_choice_after_long_think"
  | "fast_decision"
  | "unclassified_error";

export type ErrorSignal =
  | "left_winning_band"
  | "clock_pressure"
  | "piece_left_en_prise"
  | "narrow_choice_after_long_think"
  | "fast_decision"
  | "already_losing";

export interface ErrorEvidence {
  score_before_cp: number;
  score_after_cp: number;
  spent_seconds: number | null;
  clock_remaining: number | null;
  time_control_base_seconds: number | null;
  stockfish_choice_gap: number | null;
  motif: string | null;
  winning_threshold_cp: number;
}

export interface ErrorSemantics {
  primary_category: PrimaryErrorCategory;
  signals: ErrorSignal[];
  evidence: ErrorEvidence;
  /** Compatibilita' con snapshot e copy precedenti. Non usare per nuovi claim. */
  legacy_error_type: string;
  /** Euristica di ordinamento, non attribuzione causale. */
  trainability_weight: number;
  impact: number;
}

const WINNING_THRESHOLD_CP = 150;

const TRAINABILITY_WEIGHTS: Record<PrimaryErrorCategory, number> = {
  left_winning_band: 0.9,
  clock_pressure: 0.8,
  hung_piece: 1.0,
  narrow_choice_after_long_think: 0.5,
  fast_decision: 0.8,
  unclassified_error: 0.5,
};

const LEGACY_TYPE: Record<PrimaryErrorCategory, string> = {
  left_winning_band: "conversion",
  clock_pressure: "zeitnot",
  hung_piece: "hung_piece",
  narrow_choice_after_long_think: "hard_calc",
  fast_decision: "rushed",
  unclassified_error: "careless",
};

/**
 * Produce etichette descrittive supportate dai dati disponibili. Le signal sono
 * multi-label e fattuali; nessuna implica che il tempo o la difficolta' abbiano
 * causato l'errore.
 */
export function classifyErrorSemantics(input: {
  cpLoss: number;
  scoreBeforeCp: number;
  scoreAfterCp: number;
  timeState: "zeitnot" | "rushed" | "long_think" | "normal" | null;
  motif: string | null;
  stockfishChoiceGap: number | null;
  spentSeconds: number | null;
  clockRemaining: number | null;
  timeControlBaseSeconds: number | null;
}): ErrorSemantics | null {
  if (input.cpLoss < 100) return null;

  const signals: ErrorSignal[] = [];
  const leftWinningBand =
    input.scoreBeforeCp >= WINNING_THRESHOLD_CP &&
    input.scoreAfterCp < WINNING_THRESHOLD_CP;
  if (leftWinningBand) signals.push("left_winning_band");
  if (input.timeState === "zeitnot") signals.push("clock_pressure");
  if (input.motif === "pezzo_in_presa") signals.push("piece_left_en_prise");
  if (
    input.stockfishChoiceGap !== null &&
    input.stockfishChoiceGap >= 0.5 &&
    input.timeState === "long_think"
  ) {
    signals.push("narrow_choice_after_long_think");
  }
  if (input.spentSeconds !== null && input.spentSeconds <= 3) signals.push("fast_decision");
  if (input.scoreBeforeCp <= -WINNING_THRESHOLD_CP) signals.push("already_losing");

  let primary: PrimaryErrorCategory = "unclassified_error";
  if (signals.includes("left_winning_band")) primary = "left_winning_band";
  else if (signals.includes("clock_pressure")) primary = "clock_pressure";
  else if (signals.includes("piece_left_en_prise")) primary = "hung_piece";
  else if (signals.includes("narrow_choice_after_long_think")) {
    primary = "narrow_choice_after_long_think";
  }
  else if (signals.includes("fast_decision")) primary = "fast_decision";

  const impactMultiplier = signals.includes("already_losing") ? 0.3 : 1;
  return {
    primary_category: primary,
    signals,
    evidence: {
      score_before_cp: input.scoreBeforeCp,
      score_after_cp: input.scoreAfterCp,
      spent_seconds: input.spentSeconds,
      clock_remaining: input.clockRemaining,
      time_control_base_seconds: input.timeControlBaseSeconds,
      stockfish_choice_gap: input.stockfishChoiceGap,
      motif: input.motif,
      winning_threshold_cp: WINNING_THRESHOLD_CP,
    },
    legacy_error_type: LEGACY_TYPE[primary],
    trainability_weight: TRAINABILITY_WEIGHTS[primary],
    impact: Math.round(input.cpLoss * impactMultiplier),
  };
}
