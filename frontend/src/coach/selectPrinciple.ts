/**
 * selectPrinciple.ts — deterministic curriculum selector.
 *
 * Given MoveFacts + context signals from the pipeline, returns the most
 * relevant curriculum principle (and a score) to anchor the coach-llm voice.
 *
 * Logic: derive "signals" from facts (e.g. hung_piece -> "hung_piece"),
 * score each principle by overlap with its maps_to array, break ties by
 * top12 membership and lower level bracket.
 *
 * Zero LLM, zero heuristic weights — pure set-intersection + tie-break.
 */

import curriculumRaw from "./curriculum.json";
import type { MoveFacts } from "../session/moveReason";

// ── Types ────────────────────────────────────────────────────────────────────

interface CurriculumPrinciple {
  id: string;
  name_it: string;
  idea_it: string;
  fix_it: string;
  recognize: string;
  example: string;
  level: string;
  maps_to: string[];
  source_lineage: string;
}

interface Curriculum {
  _note?: string;
  principles: CurriculumPrinciple[];
  top12: string[];
}

const curriculum = curriculumRaw as unknown as Curriculum;

// ── Level ordering for tie-break (lower = more basic = preferred) ─────────

const LEVEL_ORDER: Record<string, number> = {
  "tutti":     0,
  "1000-1200": 1,
  "1200-1500": 2,
  "1500-1800": 3,
};

function levelRank(level: string): number {
  return LEVEL_ORDER[level] ?? 99;
}

// ── Signal derivation ────────────────────────────────────────────────────────
//
// Maps facts + context into a set of signal strings that mirror the
// vocabulary used in principle.maps_to.

export interface SelectContext {
  phase?: string | null;
  maiaMineTop?: number | null;
  maiaTargetTop?: number | null;
  stateBefore?: string | null;
  errorType?: string | null;
}

function deriveSignals(facts: MoveFacts, ctx: SelectContext): Set<string> {
  const signals = new Set<string>();

  // ── From hung_piece (only when there IS a physically hung piece) ─────────
  if (facts.hung_piece) {
    signals.add("hung_piece");
    signals.add("pezzo_in_presa");
    signals.add("hanging_piece");
    signals.add("cp_loss");
  }

  // ── From best.effect ────────────────────────────────────────────────────
  if (facts.best) {
    switch (facts.best.effect) {
      case "mate":
        // Missed checkmate — could be back_rank or missed_tactic
        signals.add("back_rank");
        signals.add("missed_tactic");
        signals.add("p_maia_target_top");
        break;
      case "fork":
        // Missed fork — do NOT bleed hung_piece signals unless there is one
        signals.add("fork");
        signals.add("missed_tactic");
        signals.add("p_maia_target_top");
        break;
      case "save":
        // Best move saves a hanging piece
        signals.add("pezzo_in_presa");
        signals.add("hung_piece");
        break;
      case "capture":
        // Best move is a free capture — missed_tactic but NOT hung_piece unless verified above
        signals.add("missed_tactic");
        signals.add("cp_loss");
        break;
      case "check":
        signals.add("missed_tactic");
        break;
      default:
        break;
    }
  }

  // ── From motif (pipeline label) ──────────────────────────────────────────
  if (facts.motif) {
    signals.add(facts.motif);
    if (facts.motif === "pezzo_in_presa") {
      signals.add("hung_piece");
      signals.add("hanging_piece");
    }
  }

  // ── From stateBefore ────────────────────────────────────────────────────
  const isConversion = ctx.stateBefore === "winning" || ctx.errorType === "conversion";
  if (isConversion) {
    signals.add("conversion");
    signals.add("state_before");
    // P13 (conversion) maps_to includes careless + p_maia_mine_top.
    // Surface them so P13 scores higher than phase-specific principles.
    signals.add("careless");
    signals.add("p_maia_mine_top");
    signals.add("cp_loss");
  }

  // ── From phase ───────────────────────────────────────────────────────────
  // Skip phase signals when error is conversion: the lesson applies regardless
  // of phase, and phase signals pollute results towards phase-specific principles.
  if (facts.phase && !isConversion) {
    switch (facts.phase) {
      case "apertura":   signals.add("apertura"); break;
      case "mediogioco": signals.add("mediogioco"); break;
      case "finale":     signals.add("finale"); break;
    }
  }

  // ── From errorType (pipeline classification) ─────────────────────────────
  if (ctx.errorType) {
    signals.add(ctx.errorType);
    switch (ctx.errorType) {
      case "hung_piece":
        // Only add LPDO signals if pipeline confirms it AND facts confirm it.
        // If facts.hung_piece is null (inconsistency), still trust the pipeline.
        signals.add("pezzo_in_presa");
        signals.add("hanging_piece");
        signals.add("cp_loss");
        break;
      case "missed_tactic":
        signals.add("missed_tactic");
        signals.add("p_maia_target_top");
        break;
      case "conversion":
        signals.add("conversion");
        signals.add("state_before");
        signals.add("cp_loss");
        signals.add("p_maia_mine_top");
        break;
      case "rushed":
        signals.add("rushed");
        signals.add("spent_seconds");
        signals.add("time_state");
        break;
      case "zeitnot":
        signals.add("zeitnot");
        signals.add("time_state");
        break;
      case "careless":
        signals.add("careless");
        signals.add("cp_loss");
        break;
      case "hard_calc":
        signals.add("hard_calc");
        signals.add("missed_tactic");
        break;
    }
  }

  // ── From Maia probabilities ──────────────────────────────────────────────
  const mine = ctx.maiaMineTop;
  const target = ctx.maiaTargetTop;

  if (mine != null) signals.add("p_maia_mine_top");
  if (target != null) signals.add("p_maia_target_top");

  if (mine != null && target != null) {
    // Low mine + high target = missed tactic the player should study
    if (mine < 0.35 && target > 0.55) {
      signals.add("missed_tactic");
    }
    // High mine = obvious position, player was careless (saw it, skipped it)
    if (mine > 0.55) {
      signals.add("careless");
    }
  }

  return signals;
}

// ── Score one principle ───────────────────────────────────────────────────────

function scorePrinciple(
  principle: CurriculumPrinciple,
  signals: Set<string>,
  top12Set: Set<string>,
): number {
  // Count overlapping signals
  let overlap = 0;
  for (const m of principle.maps_to) {
    if (signals.has(m)) overlap++;
  }
  if (overlap === 0) return 0;

  // Bonus for top12 membership (tie-break)
  const top12Bonus = top12Set.has(principle.id) ? 0.5 : 0;

  // Penalty for higher level (prefer basics)
  const levelPenalty = levelRank(principle.level) * 0.1;

  return overlap + top12Bonus - levelPenalty;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PrincipleSelection {
  principle: CurriculumPrinciple;
  score: number;
  signals_matched: string[];
}

/**
 * Returns the single best principle for the given facts + context.
 * Returns null if no principle has any overlap with derived signals.
 */
export function selectPrinciple(
  facts: MoveFacts,
  ctx: SelectContext,
): PrincipleSelection | null {
  const results = selectPrinciples(facts, ctx, 1);
  return results.length > 0 ? results[0] : null;
}

/**
 * Returns the top-N principles ordered by score descending.
 * Useful for debugging and for the LLM to have alternatives.
 */
export function selectPrinciples(
  facts: MoveFacts,
  ctx: SelectContext,
  n: number = 3,
): PrincipleSelection[] {
  const signals = deriveSignals(facts, ctx);
  const top12Set = new Set(curriculum.top12);

  const scored: PrincipleSelection[] = curriculum.principles
    .map((p) => {
      const score = scorePrinciple(p, signals, top12Set);
      const signals_matched = p.maps_to.filter((m) => signals.has(m));
      return { principle: p, score, signals_matched };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, n);
}
