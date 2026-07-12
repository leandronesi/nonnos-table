/**
 * Semantica applicativa della policy Maia.
 *
 * I valori della policy sono masse normalizzate prodotte dal modello. Sono
 * utili per confrontare mosse e livelli sullo stesso FEN, ma NON sono frequenze
 * calibrate su Chess.com (quindi 0.20 non significa "20 giocatori su 100").
 */
export const MAIA_POLICY_SEMANTICS = "raw_policy_mass_not_calibrated_frequency" as const;

export type MaiaPositionStatus =
  | "scored"
  | "not_requested"
  | "not_scored"
  | "skipped"
  | "unavailable";

export type MaiaReasonCode =
  | "opening_guard"
  | "target_policy_weak"
  | "target_lift_high"
  | "current_policy_supported"
  | "target_policy_supported"
  | "rating_missing"
  | "outside_scoring_cap"
  | "missing_acceptable_moves"
  | "model_unavailable";

export type MaiaDomainStatus = "cross_domain" | "out_of_training_domain";
export type MaiaDomainReason =
  | "low_clock_out_of_training_domain"
  | "chesscom_rapid_cross_domain"
  | "chesscom_blitz_cross_platform";

export interface MaiaDomainAssessment {
  status: MaiaDomainStatus;
  reason: MaiaDomainReason;
  /** false below 30s: Maia-3 excluded these moves from its training domain. */
  current_avoidable_claim_allowed: boolean;
}

export interface MaiaPositionOutcome {
  status: MaiaPositionStatus;
  reason_code: MaiaReasonCode;
}

export interface MaiaPolicyMetrics {
  /** Compatibilita': massa della sola best move Stockfish. */
  p_mine_plays_best_sf: number;
  /** Compatibilita': massa della sola best move Stockfish. */
  p_target_plays_best_sf: number;
  /** Massa della mossa realmente giocata, distinta dalle mosse buone. */
  maia_mine_played_policy: number;
  maia_target_played_policy: number;
  /**
   * Somma della policy sulle mosse accettabili OSSERVATE nelle linee MultiPV.
   * Non rappresenta necessariamente tutte le alternative equivalenti.
   */
  maia_mine_acceptable_observed_policy: number;
  maia_target_acceptable_observed_policy: number;
  /** Massimo valore della policy legale; contesto, non frequenza umana. */
  p_maia_mine_top: number;
  p_maia_target_top: number;
  /** 1 - massa target osservata; segnale Maia separato dal gap Stockfish. */
  maia_target_acceptable_observed_difficulty: number;
  /** Lift target-mine sulla massa delle mosse accettabili. */
  drill_value: number;
}

export interface MaiaCoverage {
  status: "disabled" | "no_data" | "unavailable" | "partial" | "complete";
  eligible_positions: number;
  selected_positions: number;
  scored_positions: number;
  coverage_ratio: number;
  selection_ratio: number;
  scoring_cap: number | null;
  capped_positions: number;
  cap_applied: boolean;
  current_avoidable_eligible_positions: number;
  current_avoidable_domain_coverage_ratio: number;
  domain_reason_counts: Partial<Record<MaiaDomainReason, number>>;
  reason_counts: Partial<Record<MaiaReasonCode, number>>;
  policy_semantics: typeof MAIA_POLICY_SEMANTICS;
}

/**
 * Maia-3 was trained/tested on Lichess blitz and excluded moves below 30s.
 * Chess.com data is therefore always cross-platform; rapid is cross-time-control.
 */
export function assessMaiaDomain(input: {
  timeClass: string;
  clockRemaining: number | null;
}): MaiaDomainAssessment {
  if (input.clockRemaining !== null && input.clockRemaining < 30) {
    return {
      status: "out_of_training_domain",
      reason: "low_clock_out_of_training_domain",
      current_avoidable_claim_allowed: false,
    };
  }
  if (input.timeClass === "rapid") {
    return {
      status: "cross_domain",
      reason: "chesscom_rapid_cross_domain",
      current_avoidable_claim_allowed: true,
    };
  }
  return {
    status: "cross_domain",
    reason: "chesscom_blitz_cross_platform",
    current_avoidable_claim_allowed: true,
  };
}

function finitePolicyValue(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function policyMass(policy: Record<string, number>, moves: Iterable<string>): number {
  const uniqueMoves = new Set(moves);
  let total = 0;
  for (const move of uniqueMoves) total += finitePolicyValue(policy[move]);
  return Math.min(1, total);
}

function topPolicyMass(policy: Record<string, number>): number {
  let top = 0;
  for (const value of Object.values(policy)) top = Math.max(top, finitePolicyValue(value));
  return top;
}

/** Calcola segnali separati per mossa giocata e insieme di mosse buone. */
export function scoreMaiaPolicies(input: {
  policyMine: Record<string, number>;
  policyTarget: Record<string, number>;
  playedUci: string | null;
  bestUci: string | null;
  acceptableObservedUcis: string[];
}): MaiaPolicyMetrics | null {
  const acceptable = new Set(input.acceptableObservedUcis.filter(Boolean));
  if (input.bestUci) acceptable.add(input.bestUci);
  if (acceptable.size === 0) return null;

  const pMineBest = input.bestUci
    ? finitePolicyValue(input.policyMine[input.bestUci])
    : 0;
  const pTargetBest = input.bestUci
    ? finitePolicyValue(input.policyTarget[input.bestUci])
    : 0;
  const minePlayed = input.playedUci
    ? finitePolicyValue(input.policyMine[input.playedUci])
    : 0;
  const targetPlayed = input.playedUci
    ? finitePolicyValue(input.policyTarget[input.playedUci])
    : 0;
  const mineAcceptable = policyMass(input.policyMine, acceptable);
  const targetAcceptable = policyMass(input.policyTarget, acceptable);

  return {
    p_mine_plays_best_sf: pMineBest,
    p_target_plays_best_sf: pTargetBest,
    maia_mine_played_policy: minePlayed,
    maia_target_played_policy: targetPlayed,
    maia_mine_acceptable_observed_policy: mineAcceptable,
    maia_target_acceptable_observed_policy: targetAcceptable,
    p_maia_mine_top: topPolicyMass(input.policyMine),
    p_maia_target_top: topPolicyMass(input.policyTarget),
    maia_target_acceptable_observed_difficulty: 1 - targetAcceptable,
    drill_value: targetAcceptable - mineAcceptable,
  };
}

/**
 * Ranking euristico su masse di policy, dichiaratamente non calibrate.
 * Le soglie ordinano il training set; non stimano quanti umani trovino la mossa.
 */
export function classifyMaiaPriority(
  metrics: MaiaPolicyMetrics,
  ply: number,
  options: { allowCurrentAvoidable?: boolean } = {},
): {
  priority_score: number;
  avoidable_at_current: boolean | null;
  target_relevant: boolean;
  trainable: boolean;
  training_priority_weight: number;
  reason_code: MaiaReasonCode;
} {
  const avoidableAtCurrent = options.allowCurrentAvoidable === false
    ? null
    : metrics.maia_mine_acceptable_observed_policy >= 0.30;
  const targetRelevant =
    metrics.maia_target_acceptable_observed_policy >= 0.30 &&
    (avoidableAtCurrent === null ||
      metrics.maia_target_acceptable_observed_policy >
        metrics.maia_mine_acceptable_observed_policy + 0.05);
  const targetPracticeComponent = avoidableAtCurrent === null &&
    metrics.maia_target_acceptable_observed_policy >= 0.30
      ? metrics.maia_target_acceptable_observed_policy * 0.5
      : 0;
  const trainingPriorityWeight = Math.min(
    1,
    (avoidableAtCurrent === true ? metrics.maia_mine_acceptable_observed_policy : 0) +
      Math.max(0, metrics.drill_value) +
      targetPracticeComponent,
  );

  if (ply <= 16) {
    return {
      priority_score: 0,
      avoidable_at_current: avoidableAtCurrent,
      target_relevant: targetRelevant,
      trainable: false,
      training_priority_weight: 0,
      reason_code: "opening_guard",
    };
  }
  if (
    metrics.maia_target_acceptable_observed_policy < 0.15 &&
    avoidableAtCurrent !== true
  ) {
    return {
      priority_score: 0,
      avoidable_at_current: avoidableAtCurrent,
      target_relevant: false,
      trainable: false,
      training_priority_weight: 0,
      reason_code: "target_policy_weak",
    };
  }
  if (
    metrics.drill_value >= 0.15 &&
    metrics.maia_target_acceptable_observed_policy >= 0.30
  ) {
    return {
      priority_score: 3,
      avoidable_at_current: avoidableAtCurrent,
      target_relevant: true,
      trainable: true,
      training_priority_weight: trainingPriorityWeight,
      reason_code: "target_lift_high",
    };
  }
  if (avoidableAtCurrent === true) {
    return {
      priority_score: 2,
      avoidable_at_current: true,
      target_relevant: targetRelevant,
      trainable: true,
      training_priority_weight: trainingPriorityWeight,
      reason_code: "current_policy_supported",
    };
  }
  if (metrics.maia_target_acceptable_observed_policy >= 0.30) {
    return {
      priority_score: 2,
      avoidable_at_current: avoidableAtCurrent,
      target_relevant: true,
      trainable: true,
      training_priority_weight: trainingPriorityWeight,
      reason_code: "target_policy_supported",
    };
  }
  return {
    priority_score: 1,
    avoidable_at_current: avoidableAtCurrent,
    target_relevant: false,
    trainable: false,
    training_priority_weight: 0,
    reason_code: "target_policy_weak",
  };
}

/** Riassume anche i fallback: l'assenza di score non viene piu' confusa con 0. */
export function summarizeMaiaCoverage(
  outcomes: MaiaPositionOutcome[],
  ratingAvailable: boolean,
  scoringCap: number | null = null,
  domains: MaiaDomainAssessment[] = [],
): MaiaCoverage {
  const eligible = outcomes.length;
  const scored = outcomes.filter((outcome) => outcome.status === "scored").length;
  const selected = outcomes.filter(
    (outcome) => outcome.status !== "not_requested" && outcome.status !== "not_scored",
  ).length;
  const reasonCounts: Partial<Record<MaiaReasonCode, number>> = {};
  for (const outcome of outcomes) {
    reasonCounts[outcome.reason_code] = (reasonCounts[outcome.reason_code] ?? 0) + 1;
  }
  const cappedPositions = reasonCounts.outside_scoring_cap ?? 0;
  const domainReasonCounts: Partial<Record<MaiaDomainReason, number>> = {};
  for (const domain of domains) {
    domainReasonCounts[domain.reason] = (domainReasonCounts[domain.reason] ?? 0) + 1;
  }
  const currentAvoidableEligible = domains.filter(
    (domain) => domain.current_avoidable_claim_allowed,
  ).length;

  let status: MaiaCoverage["status"];
  if (!ratingAvailable) status = "disabled";
  else if (eligible === 0) status = "no_data";
  else if (scored === 0) status = "unavailable";
  else if (scored < eligible) status = "partial";
  else status = "complete";

  return {
    status,
    eligible_positions: eligible,
    selected_positions: selected,
    scored_positions: scored,
    coverage_ratio: eligible > 0 ? scored / eligible : 0,
    selection_ratio: eligible > 0 ? selected / eligible : 0,
    scoring_cap: scoringCap,
    capped_positions: cappedPositions,
    cap_applied: cappedPositions > 0,
    current_avoidable_eligible_positions: currentAvoidableEligible,
    current_avoidable_domain_coverage_ratio:
      eligible > 0 ? currentAvoidableEligible / eligible : 0,
    domain_reason_counts: domainReasonCounts,
    reason_counts: reasonCounts,
    policy_semantics: MAIA_POLICY_SEMANTICS,
  };
}
