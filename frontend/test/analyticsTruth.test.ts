import { describe, expect, it } from "vitest";

import {
  acceptableObservedMovesFromEvaluation,
  computeSpentSeconds,
  isCriticalPosition,
} from "../src/pipeline/analysisSemantics";
import { extractMoves } from "../src/pipeline/pgnExtract";
import { buildTilt } from "../src/pipeline/playerModelLite";
import {
  classifyMaiaPriority,
  assessMaiaDomain,
  scoreMaiaPolicies,
  summarizeMaiaCoverage,
} from "../src/pipeline/maia/policySemantics";
import { classifyErrorSemantics } from "../src/pipeline/errorSemantics";
import { selectPrinciple } from "../src/coach/selectPrinciple";
import type { MoveFacts } from "../src/session/moveReason";
import { toPositionRow } from "../src/session/fromCadute";
import type { PositionExample } from "../src/pipeline/aggregate";
import type { GameAnalysis } from "../src/pipeline/analyze";

describe("clock extraction", () => {
  it("preserves decimals and a null slot when one ply has no clock tag", () => {
    const pgn = `[TimeControl "600"]

1. e4 {[%clk 0:09:58.5]} e5 2. Nf3 {note [%clk 0:09:55.25]} Nc6 {[%clk 0:09:57.75]} *`;

    const parsed = extractMoves(pgn);

    expect(parsed.sanList).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(parsed.clocks).toEqual([598.5, null, 595.25, 597.75]);
    expect(computeSpentSeconds(2, parsed.clocks, 600, 0)).toBe(3.25);
    expect(computeSpentSeconds(3, parsed.clocks, 600, 0)).toBeNull();
  });

  it("uses the base clock for the first white and black move with increment", () => {
    const clocks = [181.25, 181.5, 180.75, 180.9];

    expect(computeSpentSeconds(0, clocks, 180, 2)).toBe(0.75);
    expect(computeSpentSeconds(1, clocks, 180, 2)).toBe(0.5);
  });

  it("keeps distinct clocks when the same FEN repeats", () => {
    const pgn = `[TimeControl "300"]

1. Nf3 {[%clk 0:04:59.8]} Nf6 {[%clk 0:04:59.7]}
2. Ng1 {[%clk 0:04:58.6]} Ng8 {[%clk 0:04:58.9]}
3. Nf3 {[%clk 0:04:57.1]} *`;

    expect(extractMoves(pgn).clocks).toEqual([299.8, 299.7, 298.6, 298.9, 297.1]);
  });

  it("ignores variation clocks and standalone NAGs without shifting mainline", () => {
    const pgn = `[TimeControl "300"]

1. e4 {[%clk 0:04:59.8]} (1. d4 {[%clk 0:01:11.1]} d5)
1... e5 $1 {[%clk 0:04:59.4]} 2. Nf3 {a note without clock}
2... Nc6 {[%clk 0:04:58.2]} *`;

    const parsed = extractMoves(pgn);
    expect(parsed.sanList).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(parsed.clocks).toEqual([299.8, 299.4, null, 298.2]);
  });
});

describe("critical positions and tilt", () => {
  it("defines critical as a balanced, post-book decision rather than an advantage", () => {
    expect(isCriticalPosition(20, 100)).toBe(true);
    expect(isCriticalPosition(20, -100)).toBe(true);
    expect(isCriticalPosition(20, 300)).toBe(false);
    expect(isCriticalPosition(12, 0)).toBe(false);
  });

  it("counts only the immediately following move and keeps blunders out of baseline", () => {
    const analysis = {
      moves: [
        { category: "ok", cpLoss: 10 },
        { category: "blunder", cpLoss: 300 },
        { category: "mistake", cpLoss: 80 },
        { category: "ok", cpLoss: 20 },
        { category: "blunder", cpLoss: 250 },
      ],
    } as unknown as GameAnalysis;

    expect(buildTilt([analysis])).toEqual({
      after_blunder_avg_cp_loss: 80,
      after_blunder_n: 1,
      baseline_avg_cp_loss: 15,
      baseline_n: 2,
      tilt_factor: 80 / 15,
    });
  });
});

describe("Stockfish acceptable set", () => {
  it("keeps only observed MultiPV lines inside the cp tolerance", () => {
    const observed = acceptableObservedMovesFromEvaluation({
      bestMoveUci: "e2e4",
      lines: [
        { moveUci: "e2e4", scoreCp: 100, mate: null },
        { moveUci: "d2d4", scoreCp: 65, mate: null },
        { moveUci: "g1f3", scoreCp: 20, mate: null },
      ],
    });

    expect(observed).toEqual(["e2e4", "d2d4"]);
  });
});

describe("stable position identity", () => {
  it("keeps real game/eval facts when cadute are reordered", () => {
    const example = {
      source_game_id: "game-uuid-123",
      position_id: "game-uuid-123:27",
      color: "white",
      phase: "mediogioco",
      ply: 27,
      san: "a3",
      played_uci: "a2a3",
      best_uci: "e2e4",
      cp_loss: 180,
      score_before_cp: 90,
      score_after_cp: -90,
      fen_before: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      category: "mistake",
      game_url: "https://www.chess.com/game/live/123",
    } as PositionExample;

    const firstOrder = toPositionRow(example, 0);
    const secondOrder = toPositionRow(example, 9);
    expect(firstOrder.game_id).toBe("game-uuid-123");
    expect(firstOrder.position_id).toBe("game-uuid-123:27");
    expect(secondOrder.game_id).toBe(firstOrder.game_id);
    expect(secondOrder.position_id).toBe(firstOrder.position_id);
    expect(firstOrder.cp_before).toBe(90);
    expect(firstOrder.cp_after).toBe(-90);
    expect(firstOrder.url).toBe("https://www.chess.com/game/live/123");
  });

  it("keeps unknown legacy evals null instead of inventing proxies", () => {
    const legacy = {
      color: "black",
      phase: "finale",
      ply: 40,
      san: "Kh7",
      played_uci: "g8h7",
      best_uci: null,
      cp_loss: 220,
      fen_before: "8/8/8/8/8/8/5k2/7K b - - 0 1",
      category: "mistake",
      priority_score: 2,
    } as unknown as PositionExample;

    const row = toPositionRow(legacy, 4);
    expect(row.cp_before).toBeNull();
    expect(row.cp_after).toBeNull();
    expect(row.priority_score).toBe(2);
    expect(row.game_id).toMatch(/^legacy_/);
  });
});

describe("conservative error semantics", () => {
  const base = {
    cpLoss: 150,
    timeState: "normal" as const,
    motif: null,
    stockfishChoiceGap: null,
    spentSeconds: 10,
    clockRemaining: 200,
    timeControlBaseSeconds: 600,
  };

  it("marks left_winning_band only when the move exits that threshold", () => {
    const stillWinning = classifyErrorSemantics({
      ...base,
      scoreBeforeCp: 500,
      scoreAfterCp: 350,
    });
    const exitedBand = classifyErrorSemantics({
      ...base,
      cpLoss: 400,
      scoreBeforeCp: 500,
      scoreAfterCp: 100,
    });

    expect(stillWinning?.primary_category).toBe("unclassified_error");
    expect(stillWinning?.signals).not.toContain("left_winning_band");
    expect(exitedBand?.primary_category).toBe("left_winning_band");
    expect(exitedBand?.signals).toContain("left_winning_band");
  });

  it("records a fast decision as factual evidence, not legacy rushed causality", () => {
    const result = classifyErrorSemantics({
      ...base,
      scoreBeforeCp: 50,
      scoreAfterCp: -100,
      spentSeconds: 2.5,
    });

    expect(result?.primary_category).toBe("fast_decision");
    expect(result?.signals).toContain("fast_decision");
    expect(result?.evidence.spent_seconds).toBe(2.5);
    expect(result?.legacy_error_type).toBe("rushed");
  });

  it("does not infer a missed tactic from a MultiPV gap alone", () => {
    const gapOnly = classifyErrorSemantics({
      ...base,
      scoreBeforeCp: 50,
      scoreAfterCp: -100,
      stockfishChoiceGap: 0.8,
    });
    const gapAfterLongThink = classifyErrorSemantics({
      ...base,
      scoreBeforeCp: 50,
      scoreAfterCp: -100,
      stockfishChoiceGap: 0.8,
      timeState: "long_think",
      spentSeconds: 35,
    });

    expect(gapOnly?.primary_category).toBe("unclassified_error");
    expect(gapOnly?.signals).not.toContain("narrow_choice_after_long_think");
    expect(gapAfterLongThink?.primary_category).toBe("narrow_choice_after_long_think");
  });

  it("carries the canonical left_winning_band key into the matching principle", () => {
    const error = classifyErrorSemantics({
      ...base,
      cpLoss: 400,
      scoreBeforeCp: 500,
      scoreAfterCp: 100,
    });
    if (!error) throw new Error("expected error semantics");
    const facts: MoveFacts = {
      hung_piece: null,
      punishment: null,
      best: null,
      motif: null,
      phase: "mediogioco",
      played_san: "a3",
    };

    const selected = selectPrinciple(facts, {
      errorType: error.primary_category,
      errorSignals: error.signals,
      stateBefore: "winning",
    });
    expect(selected?.principle.id).toBe("P13");

    const notLost = selectPrinciple(facts, {
      errorType: "unclassified_error",
      errorSignals: [],
      stateBefore: "winning",
    });
    expect(notLost?.principle.id).not.toBe("P13");
  });
});

describe("Maia policy semantics", () => {
  it("separates played-move mass from summed good-move mass", () => {
    const metrics = scoreMaiaPolicies({
      policyMine: { e2e4: 0.10, d2d4: 0.20, a2a3: 0.60, g1f3: 0.10 },
      policyTarget: { e2e4: 0.25, d2d4: 0.35, a2a3: 0.20, g1f3: 0.20 },
      playedUci: "a2a3",
      bestUci: "e2e4",
      acceptableObservedUcis: ["e2e4", "d2d4"],
    });

    expect(metrics).not.toBeNull();
    expect(metrics?.maia_mine_played_policy).toBeCloseTo(0.60);
    expect(metrics?.maia_mine_acceptable_observed_policy).toBeCloseTo(0.30);
    expect(metrics?.maia_target_played_policy).toBeCloseTo(0.20);
    expect(metrics?.maia_target_acceptable_observed_policy).toBeCloseTo(0.60);
    expect(metrics?.p_mine_plays_best_sf).toBeCloseTo(0.10);
  });

  it("does not call a target-only lift avoidable at the current level", () => {
    const metrics = scoreMaiaPolicies({
      policyMine: { e2e4: 0.10, d2d4: 0.05, a2a3: 0.85 },
      policyTarget: { e2e4: 0.30, d2d4: 0.25, a2a3: 0.45 },
      playedUci: "a2a3",
      bestUci: "e2e4",
      acceptableObservedUcis: ["e2e4", "d2d4"],
    });
    if (!metrics) throw new Error("expected Maia metrics");

    expect(classifyMaiaPriority(metrics, 24)).toEqual({
      priority_score: 3,
      avoidable_at_current: false,
      target_relevant: true,
      trainable: true,
      training_priority_weight: 0.4,
      reason_code: "target_lift_high",
    });
  });

  it("keeps a current-avoidable position valuable when mine and target are equal", () => {
    const metrics = scoreMaiaPolicies({
      policyMine: { e2e4: 0.35, d2d4: 0.25, a2a3: 0.40 },
      policyTarget: { e2e4: 0.35, d2d4: 0.25, a2a3: 0.40 },
      playedUci: "a2a3",
      bestUci: "e2e4",
      acceptableObservedUcis: ["e2e4", "d2d4"],
    });
    if (!metrics) throw new Error("expected Maia metrics");

    const priority = classifyMaiaPriority(metrics, 24);
    expect(priority.avoidable_at_current).toBe(true);
    expect(priority.target_relevant).toBe(false);
    expect(priority.training_priority_weight).toBeCloseTo(0.6);
  });

  it("makes current avoidability unknown below Maia-3's 30s training cutoff", () => {
    const domain = assessMaiaDomain({ timeClass: "blitz", clockRemaining: 12 });
    const rapidDomain = assessMaiaDomain({ timeClass: "rapid", clockRemaining: 90 });
    const metrics = scoreMaiaPolicies({
      policyMine: { e2e4: 0.35, d2d4: 0.25, a2a3: 0.40 },
      policyTarget: { e2e4: 0.35, d2d4: 0.25, a2a3: 0.40 },
      playedUci: "a2a3",
      bestUci: "e2e4",
      acceptableObservedUcis: ["e2e4", "d2d4"],
    });
    if (!metrics) throw new Error("expected Maia metrics");

    const priority = classifyMaiaPriority(metrics, 24, {
      allowCurrentAvoidable: domain.current_avoidable_claim_allowed,
    });
    expect(domain.reason).toBe("low_clock_out_of_training_domain");
    expect(rapidDomain.reason).toBe("chesscom_rapid_cross_domain");
    expect(priority.avoidable_at_current).toBeNull();
    expect(priority.target_relevant).toBe(true);
    expect(priority.trainable).toBe(true);
    expect(priority.training_priority_weight).toBeCloseTo(0.3);
  });

  it("reports model fallback explicitly in status and coverage", () => {
    const coverage = summarizeMaiaCoverage(
      [
        { status: "unavailable", reason_code: "model_unavailable" },
        { status: "not_scored", reason_code: "outside_scoring_cap" },
      ],
      true,
      1,
      [
        assessMaiaDomain({ timeClass: "blitz", clockRemaining: 12 }),
        assessMaiaDomain({ timeClass: "rapid", clockRemaining: 90 }),
      ],
    );

    expect(coverage.status).toBe("unavailable");
    expect(coverage.eligible_positions).toBe(2);
    expect(coverage.selected_positions).toBe(1);
    expect(coverage.scored_positions).toBe(0);
    expect(coverage.coverage_ratio).toBe(0);
    expect(coverage.scoring_cap).toBe(1);
    expect(coverage.capped_positions).toBe(1);
    expect(coverage.cap_applied).toBe(true);
    expect(coverage.current_avoidable_eligible_positions).toBe(1);
    expect(coverage.current_avoidable_domain_coverage_ratio).toBe(0.5);
    expect(coverage.domain_reason_counts).toEqual({
      low_clock_out_of_training_domain: 1,
      chesscom_rapid_cross_domain: 1,
    });
    expect(coverage.reason_counts).toEqual({
      model_unavailable: 1,
      outside_scoring_cap: 1,
    });
    expect(coverage.policy_semantics).toBe("raw_policy_mass_not_calibrated_frequency");
  });
});
