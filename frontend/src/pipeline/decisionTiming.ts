/** Clock evidence for every decision, independent of whether the move was good. */
export const TIMING_VERSION = 1;

/** Simple sudden-death/Fischer controls only; staged and daily controls need a different clock model. */
export function parseClockControl(value: string | null | undefined): { base: number; increment: number } | null {
  const match = value?.match(/^(\d+)(?:\+(\d+))?$/);
  if (!match) return null;
  const base = Number(match[1]);
  const increment = Number(match[2] ?? 0);
  return Number.isSafeInteger(base) && base > 0 && Number.isSafeInteger(increment)
    ? { base, increment } : null;
}

export interface TimingInput {
  spentSeconds: number | null;
  clockBeforeSeconds?: number | null;
  clockRemaining: number | null;
  baseSeconds: number | null;
  incrementSeconds?: number | null;
  ply: number;
  scoreBeforeCp: number;
  stockfishChoiceGap?: number | null;
  legalMoveCount?: number;
}

export interface DecisionTiming {
  version: typeof TIMING_VERSION;
  status: "available" | "missing_clock" | "unknown_time_control" | "invalid_clock";
  clockBeforeSeconds: number | null;
  spentSeconds: number | null;
  reserve: "ample" | "limited" | "pressure" | null;
  pace: "fast" | "considered" | null;
  context: "narrow_choice" | "other_choice";
  eligible: boolean;
  excludedReason: "opening" | "decided_position" | "forced_move" | "clock_unavailable" | null;
  thresholds: { fastSeconds: number; ampleSeconds: number; pressureSeconds: number } | null;
}

const nonnegative = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * Explicit heuristics, not a model of how long a player should think.
 * Missing historical increment is never silently replaced with zero.
 * Clock after the move includes increment; reserve refers to BEFORE thinking.
 */
export function assessDecisionTiming(input: TimingInput): DecisionTiming {
  const result: DecisionTiming = {
    version: TIMING_VERSION,
    status: "missing_clock",
    clockBeforeSeconds: null,
    spentSeconds: nonnegative(input.spentSeconds) ? input.spentSeconds : null,
    reserve: null,
    pace: null,
    context: (input.stockfishChoiceGap ?? 0) >= 0.5 ? "narrow_choice" : "other_choice",
    eligible: false,
    excludedReason: "clock_unavailable",
    thresholds: null,
  };
  if (!nonnegative(input.baseSeconds) || input.baseSeconds === 0 || !nonnegative(input.incrementSeconds)) {
    return { ...result, status: "unknown_time_control" };
  }
  if (input.spentSeconds == null || input.clockRemaining == null) return result;
  if (!nonnegative(input.spentSeconds) || !nonnegative(input.clockRemaining)) {
    return { ...result, status: "invalid_clock" };
  }
  const reconstructed = input.clockRemaining + input.spentSeconds - input.incrementSeconds;
  const before = input.clockBeforeSeconds === undefined ? reconstructed : input.clockBeforeSeconds;
  if (before === null) return result;
  if (!nonnegative(before) || Math.abs(before - reconstructed) > 0.1 || input.spentSeconds > before + 0.1) {
    return { ...result, status: "invalid_clock" };
  }
  const thresholds = {
    fastSeconds: Math.min(5, Math.max(2, input.baseSeconds * 0.005)),
    ampleSeconds: Math.max(60, input.baseSeconds * 0.25, input.incrementSeconds * 10),
    pressureSeconds: Math.max(10, Math.min(60, input.baseSeconds * 0.1)),
  };
  const excludedReason = input.legalMoveCount === 1 ? "forced_move"
    : input.ply <= 16 ? "opening"
    : Math.abs(input.scoreBeforeCp) > 600 ? "decided_position" : null;
  return {
    ...result,
    status: "available",
    clockBeforeSeconds: before,
    thresholds,
    reserve: before <= thresholds.pressureSeconds ? "pressure"
      : before >= thresholds.ampleSeconds ? "ample" : "limited",
    pace: input.spentSeconds <= thresholds.fastSeconds ? "fast" : "considered",
    eligible: excludedReason === null,
    excludedReason,
  };
}

export interface TimingMove extends TimingInput {
  cpLoss: number;
  phase: string;
  fenBefore: string;
  san: string;
  uci: string;
  bestMoveUci: string | null;
}

export interface TimingGame {
  gameId: string;
  playedAt: string;
  timeClass: string;
  baseSeconds: number | null;
  incrementSeconds?: number | null;
  moves: Array<Omit<TimingMove, "baseSeconds" | "incrementSeconds">>;
}

export interface TimingExample {
  positionId: string;
  gameId: string;
  playedAt: string;
  ply: number;
  fenBefore: string;
  playedUci: string;
  playedSan: string;
  bestMoveUci: string | null;
  cpLoss: number;
  clockBeforeSeconds: number;
  spentSeconds: number;
}

export interface TimingBucket {
  opportunities: number;
  errors: number;
  handled: number;
  games: number;
  errorGames: number;
  /** Suppressed below eight opportunities across at least three games. */
  errorRate: number | null;
}

export interface TimingStratum {
  key: string;
  timeClass: string;
  baseSeconds: number;
  incrementSeconds: number;
  phase: string;
  context: DecisionTiming["context"];
  thresholds: NonNullable<DecisionTiming["thresholds"]>;
  fastWithTime: TimingBucket;
  consideredWithTime: TimingBucket;
  underPressure: TimingBucket;
  /** Association within this stratum; never a causal effect. */
  errorRateDifference: number | null;
  evidence: "insufficient" | "observed" | "recurring_errors";
  examples: TimingExample[];
  successfulExamples: TimingExample[];
  trend: {
    recent: TimingBucket;
    previous: TimingBucket;
    recentWithTime: TimingBucket;
    previousWithTime: TimingBucket;
    recentFastShare: number | null;
    previousFastShare: number | null;
    errorRateDifference: number | null;
  } | null;
}

export interface TimingReport {
  version: typeof TIMING_VERSION;
  games: number;
  moves: number;
  measuredMoves: number;
  eligibleMoves: number;
  coverage: number | null;
  unavailable: Record<Exclude<DecisionTiming["status"], "available">, number>;
  strata: TimingStratum[];
}

interface Observation {
  game: TimingGame;
  move: TimingGame["moves"][number];
  timing: DecisionTiming;
}

function summarize(rows: Observation[]): TimingBucket {
  const games = new Set(rows.map((r) => r.game.gameId)).size;
  const errors = rows.filter((r) => r.move.cpLoss >= 100);
  return {
    opportunities: rows.length,
    errors: errors.length,
    handled: rows.filter((r) => r.move.cpLoss < 50).length,
    games,
    errorGames: new Set(errors.map((r) => r.game.gameId)).size,
    errorRate: rows.length >= 8 && games >= 3 ? errors.length / rows.length : null,
  };
}

function example(row: Observation): TimingExample {
  return {
    positionId: `${row.game.gameId}:${row.move.ply}`,
    gameId: row.game.gameId,
    playedAt: row.game.playedAt,
    ply: row.move.ply,
    fenBefore: row.move.fenBefore,
    playedUci: row.move.uci,
    playedSan: row.move.san,
    bestMoveUci: row.move.bestMoveUci,
    cpLoss: row.move.cpLoss,
    clockBeforeSeconds: row.timing.clockBeforeSeconds!,
    spentSeconds: row.timing.spentSeconds!,
  };
}

/** Select examples from different games before repeating any one source game. */
function examples(rows: Observation[]): TimingExample[] {
  const games = new Set<string>();
  return rows.filter((row) => {
    if (games.has(row.game.gameId)) return false;
    games.add(row.game.gameId);
    return true;
  }).slice(0, 3).map(example);
}

/**
 * All decisions enter coverage; only comparable non-book choices enter patterns.
 * Duplicate games/plies are ignored. Windows are ten games of the SAME control,
 * including games without this pattern, never the ten most recent errors.
 */
export function buildTimingReport(input: TimingGame[]): TimingReport {
  const games = [...new Map(input.map((game) => [game.gameId, game])).values()];
  const report: TimingReport = {
    version: TIMING_VERSION, games: games.length, moves: 0, measuredMoves: 0,
    eligibleMoves: 0, coverage: null,
    unavailable: { missing_clock: 0, unknown_time_control: 0, invalid_clock: 0 }, strata: [],
  };
  const groups = new Map<string, Observation[]>();
  for (const game of games) {
    const seen = new Set<number>();
    for (const move of game.moves) {
      if (seen.has(move.ply)) continue;
      seen.add(move.ply);
      report.moves++;
      const timing = assessDecisionTiming({ ...move, baseSeconds: game.baseSeconds, incrementSeconds: game.incrementSeconds });
      if (timing.status !== "available") {
        report.unavailable[timing.status]++;
        continue;
      }
      report.measuredMoves++;
      if (!timing.eligible || !Number.isFinite(move.cpLoss)) continue;
      report.eligibleMoves++;
      const key = [game.timeClass, game.baseSeconds, game.incrementSeconds, move.phase, timing.context].join(":");
      const group = groups.get(key) ?? [];
      group.push({ game, move, timing });
      groups.set(key, group);
    }
  }
  report.coverage = report.moves ? report.measuredMoves / report.moves : null;
  for (const [key, rows] of groups) {
    const first = rows[0];
    const fast = rows.filter((r) => r.timing.reserve === "ample" && r.timing.pace === "fast");
    const considered = rows.filter((r) => r.timing.reserve === "ample" && r.timing.pace === "considered");
    const fastBucket = summarize(fast);
    const consideredBucket = summarize(considered);
    const controlGames = games.filter((g) => g.timeClass === first.game.timeClass
      && g.baseSeconds === first.game.baseSeconds && g.incrementSeconds === first.game.incrementSeconds
      && Number.isFinite(Date.parse(g.playedAt)))
      .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt) || a.gameId.localeCompare(b.gameId));
    let trend: TimingStratum["trend"] = null;
    if (controlGames.length >= 20) {
      const recentIds = new Set(controlGames.slice(0, 10).map((g) => g.gameId));
      const previousIds = new Set(controlGames.slice(10, 20).map((g) => g.gameId));
      const recent = summarize(fast.filter((r) => recentIds.has(r.game.gameId)));
      const previous = summarize(fast.filter((r) => previousIds.has(r.game.gameId)));
      const recentWithTime = summarize(rows.filter((r) => recentIds.has(r.game.gameId) && r.timing.reserve === "ample"));
      const previousWithTime = summarize(rows.filter((r) => previousIds.has(r.game.gameId) && r.timing.reserve === "ample"));
      trend = {
        recent, previous,
        recentWithTime, previousWithTime,
        recentFastShare: recentWithTime.errorRate === null ? null : recent.opportunities / recentWithTime.opportunities,
        previousFastShare: previousWithTime.errorRate === null ? null : previous.opportunities / previousWithTime.opportunities,
        errorRateDifference: recent.errorRate !== null && previous.errorRate !== null
          ? recent.errorRate - previous.errorRate : null,
      };
    }
    report.strata.push({
      key, timeClass: first.game.timeClass,
      baseSeconds: first.game.baseSeconds!, incrementSeconds: first.game.incrementSeconds!,
      phase: first.move.phase, context: first.timing.context, thresholds: first.timing.thresholds!,
      fastWithTime: fastBucket, consideredWithTime: consideredBucket,
      underPressure: summarize(rows.filter((r) => r.timing.reserve === "pressure")),
      errorRateDifference: fastBucket.errorRate !== null && consideredBucket.errorRate !== null
        ? fastBucket.errorRate - consideredBucket.errorRate : null,
      evidence: fastBucket.errorRate === null ? "insufficient"
        : fastBucket.errorGames >= 3 ? "recurring_errors" : "observed",
      examples: examples(fast.filter((r) => r.move.cpLoss >= 100).sort((a, b) => b.move.cpLoss - a.move.cpLoss)),
      successfulExamples: examples(fast.filter((r) => r.move.cpLoss < 50)),
      trend,
    });
  }
  report.strata.sort((a, b) => b.fastWithTime.errorGames - a.fastWithTime.errorGames
    || b.fastWithTime.errors - a.fastWithTime.errors || a.key.localeCompare(b.key));
  return report;
}
