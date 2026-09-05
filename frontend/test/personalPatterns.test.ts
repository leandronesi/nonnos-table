import { describe, expect, it } from "vitest";
import { collectPatternOpportunities, selectPatternSample, buildPersonalPatternReport, type PatternOpportunity, type PatternSourceGame } from "../src/pipeline/personalPatterns";
import type { GameAnalysis } from "../src/pipeline/analyze";

function source(index: number, cpLoss = 0): PatternSourceGame {
  // Fields not consumed by opportunity extraction are intentionally omitted here.
  const analysis = {
    chess_com_uuid: `g${index}`, played_at: "2026-09-01T12:00:00Z", color: "white", time_class: "rapid",
    moves: Array.from({ length: 12 }, (_, i) => ({
      ply: 17 + i * 2, fenBefore: "8/8/8/8/8/8/4K3/7k w - - 0 13",
      san: "Kd3", uci: "e2d3", bestMoveUci: "e2e3", acceptableObservedMoveUcis: ["e2e3"],
      cpLoss, scoreBeforeCp: 0, phase: "middlegame", spentSeconds: 2, clockRemaining: 298,
      clockBeforeSeconds: 300, legalMoveCount: 20, stockfishChoiceGap: 0.6,
      opportunityMotif: "fork",
    })),
  } as unknown as GameAnalysis;
  return { analysis, baseSeconds: 600, incrementSeconds: 0, opponentRating: 1300 };
}

describe("personal patterns from all opportunities", () => {
  it("retains correctly played positions and their stable source identity", () => {
    const opportunities = collectPatternOpportunities([source(1), source(2, 150), source(1)]);
    expect(opportunities).toHaveLength(24);
    expect(opportunities[0]).toMatchObject({ id: "g1:17", cpLoss: 0, kinds: ["fork", "narrow_choice", "time_reserve"], opponentRating: 1300 });
    const report = buildPersonalPatternReport(opportunities, new Map(), 1200, 1400);
    expect(report.patterns.find((p) => p.kind === "fork")).toMatchObject({ opportunities: 24, errors: 12, handled: 12, games: 2, evidence: "insufficient", priority: 0 });
  });

  it("identifies recurring errors across games, not repeated failures in one game", () => {
    const opportunities = collectPatternOpportunities([source(1, 150), source(2, 150), source(3, 150), source(4)]);
    const pattern = buildPersonalPatternReport(opportunities, new Map(), 1200, 1400).patterns.find((p) => p.kind === "fork")!;
    expect(pattern.evidence).toBe("recurring");
    expect(pattern.errorGames).toBe(3);
    expect(pattern.examples.map((p) => p.gameId)).toEqual(["g1", "g2", "g3"]);
    expect(pattern.successfulExamples[0].gameId).toBe("g4");
    expect(pattern.maia.currentSupport).toBeNull();
  });

  it("does not treat slower errors as evidence of rushing with time available", () => {
    const input = source(1, 150);
    input.analysis.moves.forEach((m) => { m.spentSeconds = 20; m.clockRemaining = 280; });
    const patterns = buildPersonalPatternReport(collectPatternOpportunities([input]), new Map(), 1200, 1400).patterns;
    expect(patterns.find((p) => p.kind === "time_reserve")).toMatchObject({ opportunities: 12, errors: 0, fastDecisions: 0 });
    expect(patterns.find((p) => p.kind === "fork")?.errors).toBe(12);
  });

  it("supports legacy occurrence records without turning missing records into motifs", () => {
    const input = source(1);
    input.analysis.moves.forEach((m) => { delete m.opportunityMotif; });
    input.analysis.motif_occurrences = [{ motif: "back_rank", handled: true, played_at: input.analysis.played_at, phase: "middlegame" }];
    const opportunities = collectPatternOpportunities([input]);
    expect(opportunities[0].kinds).toContain("back_rank");
    expect(opportunities[1].kinds).not.toContain("back_rank");
  });
});

describe("Maia sampling", () => {
  it("is outcome-independent, reproducible across input order, bounded, and balances games", () => {
    const opportunities = collectPatternOpportunities([source(1), source(2, 500), source(3)]);
    const sample = selectPatternSample(opportunities, 6);
    const changedResults = opportunities.map((p) => ({ ...p, cpLoss: 1000 - p.cpLoss })).reverse();
    expect(selectPatternSample(changedResults, 6).map((p) => p.id)).toEqual(sample.map((p) => p.id));
    expect(sample).toHaveLength(6);
    expect(new Set(sample.map((p) => p.gameId)).size).toBe(3);
    expect(new Set(sample.map((p) => p.id)).size).toBe(6);
  });

  it("does not spend inference on low-clock positions outside Maia's training domain", () => {
    const opportunities = collectPatternOpportunities([source(1)]);
    const lowClock: PatternOpportunity = { ...opportunities[0], clockRemaining: 12 };
    expect(selectPatternSample([lowClock], 400)).toEqual([]);
    expect(selectPatternSample(opportunities, 0)).toEqual([]);
    expect(selectPatternSample(opportunities, NaN)).toEqual([]);
  });
});
