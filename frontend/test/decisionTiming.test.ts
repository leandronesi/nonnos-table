import { describe, expect, it } from "vitest";
import { assessDecisionTiming, buildTimingReport, parseClockControl, type TimingGame, type TimingInput } from "../src/pipeline/decisionTiming";
import { computeSpentSeconds } from "../src/pipeline/analysisSemantics";
import { extractMoves } from "../src/pipeline/pgnExtract";

const choice = (patch: Partial<TimingInput> = {}): TimingInput => ({
  spentSeconds: 2, clockBeforeSeconds: 300, clockRemaining: 298,
  baseSeconds: 600, incrementSeconds: 0, ply: 25, scoreBeforeCp: 20,
  stockfishChoiceGap: 0.7, legalMoveCount: 24, ...patch,
});

function game(id: number, losses = [200, 0, 0], patch: Partial<TimingGame> = {}): TimingGame {
  return {
    gameId: `game-${id}`, playedAt: new Date(Date.UTC(2026, 7, id)).toISOString(),
    timeClass: "rapid", baseSeconds: 600, incrementSeconds: 0,
    moves: losses.map((cpLoss, i) => ({
      ...choice(), ply: 25 + i * 2, cpLoss, phase: "middlegame",
      fenBefore: "8/8/8/8/8/8/4K3/7k w - - 0 13", san: "Kd3", uci: "e2d3", bestMoveUci: "e2e3",
    })), ...patch,
  };
}

describe("decision timing from source clocks", () => {
  it("separates available time before thinking from the increment after moving", () => {
    const parsed = extractMoves(`[TimeControl "180+10"]\n\n1. e4 {[%clk 0:03:09]} e5 {[%clk 0:03:08]} 2. Nf3 {[%clk 0:03:17]} *`);
    const control = parseClockControl(parsed.headers.TimeControl)!;
    const spent = computeSpentSeconds(2, parsed.clocks, control.base, control.increment);
    expect(spent).toBe(2);
    const timing = assessDecisionTiming(choice({
      spentSeconds: spent, clockBeforeSeconds: parsed.clocks[0], clockRemaining: parsed.clocks[2],
      baseSeconds: control.base, incrementSeconds: control.increment,
    }));
    expect(timing.status).toBe("available");
    expect(timing.clockBeforeSeconds).toBe(189);
    expect(timing.reserve).toBe("ample");
  });

  it("does not let a large increment hide pressure at the beginning of the decision", () => {
    const result = assessDecisionTiming(choice({ clockBeforeSeconds: 8, clockRemaining: 36, incrementSeconds: 30 }));
    expect(result.reserve).toBe("pressure");
    expect(result.pace).toBe("fast");
  });

  it("keeps unknown controls, gaps and inconsistent clocks out of the denominator", () => {
    expect(assessDecisionTiming(choice({ incrementSeconds: undefined })).status).toBe("unknown_time_control");
    expect(assessDecisionTiming(choice({ spentSeconds: null })).status).toBe("missing_clock");
    expect(assessDecisionTiming(choice({ clockBeforeSeconds: null })).status).toBe("missing_clock");
    expect(assessDecisionTiming(choice({ clockRemaining: 400 })).status).toBe("invalid_clock");
    expect(assessDecisionTiming(choice({ spentSeconds: NaN })).status).toBe("invalid_clock");
    expect(assessDecisionTiming(choice({ clockBeforeSeconds: 1, spentSeconds: 2, clockRemaining: 9, incrementSeconds: 10 })).status).toBe("invalid_clock");
    expect(parseClockControl("40/7200:3600")).toBeNull();
    expect(parseClockControl("1/259200")).toBeNull();
    expect(parseClockControl("600")).toEqual({ base: 600, increment: 0 });
  });

  it("reconstructs legacy before-clock only when increment is known", () => {
    expect(assessDecisionTiming(choice({ clockBeforeSeconds: undefined, incrementSeconds: 2, clockRemaining: 300 })).clockBeforeSeconds).toBe(300);
  });

  it("does not call a book move, forced move or already decided position a timing opportunity", () => {
    for (const patch of [{ ply: 5 }, { legalMoveCount: 1 }, { scoreBeforeCp: -700 }]) {
      const result = assessDecisionTiming(choice(patch));
      expect(result.status).toBe("available");
      expect(result.eligible).toBe(false);
    }
    expect(assessDecisionTiming(choice()).eligible).toBe(true);
  });
});

describe("longitudinal timing evidence", () => {
  it("counts successful fast decisions, requires multiple source games, and preserves proof", () => {
    const report = buildTimingReport([game(1), game(2), game(3)]);
    const pattern = report.strata[0];
    expect(pattern.fastWithTime).toMatchObject({ opportunities: 9, errors: 3, handled: 6, errorGames: 3, errorRate: 1 / 3 });
    expect(pattern.evidence).toBe("recurring_errors");
    expect(pattern.examples.map((p) => p.gameId)).toEqual(["game-1", "game-2", "game-3"]);
    expect(pattern.successfulExamples).toHaveLength(3);
    expect(pattern.examples[0]).toMatchObject({ positionId: "game-1:25", clockBeforeSeconds: 300, spentSeconds: 2 });
  });

  it("withholds sparse rates and never labels fast correct play an error", () => {
    expect(buildTimingReport([game(1, Array(20).fill(200))]).strata[0].fastWithTime.errorRate).toBeNull();
    const correct = buildTimingReport([game(1, [0, 0, 0]), game(2, [0, 0, 0]), game(3, [0, 0, 0])]).strata[0];
    expect(correct.evidence).toBe("observed");
    expect(correct.fastWithTime.errorRate).toBe(0);
  });

  it("does not mix increment, phase, choice context or cadence", () => {
    const differentIncrement = game(2, [200], { incrementSeconds: 2 });
    differentIncrement.moves[0].clockRemaining = 300;
    const differentPhase = game(3, [200]);
    differentPhase.moves[0].phase = "endgame";
    const differentContext = game(4, [200]);
    differentContext.moves[0].stockfishChoiceGap = 0.1;
    const report = buildTimingReport([game(1), differentIncrement, differentPhase, differentContext, game(5, [200], { timeClass: "blitz" })]);
    expect(report.strata).toHaveLength(5);
  });

  it("does not inflate evidence on replay and reports missing coverage", () => {
    const first = game(1);
    first.moves.push(first.moves[0]);
    const missing = game(2);
    missing.moves.forEach((m) => { m.spentSeconds = null; });
    const report = buildTimingReport([first, first, missing]);
    expect(report.games).toBe(2);
    expect(report.moves).toBe(6);
    expect(report.measuredMoves).toBe(3);
    expect(report.coverage).toBe(0.5);
    expect(report.unavailable.missing_clock).toBe(3);
  });

  it("uses chronological game windows including games without opportunities", () => {
    const games = Array.from({ length: 20 }, (_, i) => game(i + 1));
    games.slice(10).forEach((g) => { g.moves = []; });
    const trend = buildTimingReport(games).strata[0].trend!;
    expect(trend.previous.opportunities).toBe(30);
    expect(trend.recent.opportunities).toBe(0);
    expect(trend.errorRateDifference).toBeNull();
    expect(buildTimingReport(games.slice(0, 19)).strata[0].trend).toBeNull();
  });

  it("compares error rates only when both fast and considered groups have evidence", () => {
    const games = [game(1), game(2), game(3)];
    games.forEach((g) => g.moves.push(...g.moves.map((m) => ({ ...m, ply: m.ply + 20, spentSeconds: 15, clockRemaining: 285, cpLoss: 0 }))));
    const pattern = buildTimingReport(games).strata[0];
    expect(pattern.errorRateDifference).toBe(1 / 3);
    expect(pattern.consideredWithTime.opportunities).toBe(9);
  });

  it("measures a change in pacing even when recent decisions are no longer fast", () => {
    const games = Array.from({ length: 20 }, (_, i) => game(i + 1));
    games.slice(10).forEach((g) => g.moves.forEach((m) => { m.spentSeconds = 15; m.clockRemaining = 285; }));
    const trend = buildTimingReport(games).strata[0].trend!;
    expect(trend.previousFastShare).toBe(1);
    expect(trend.recentFastShare).toBe(0);
    expect(trend.recentWithTime.opportunities).toBe(30);
    expect(trend.recent.errorRate).toBeNull();
  });
});
