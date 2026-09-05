/** Longitudinal observations are independent of exercise success. */
export interface PatternObservation {
  startedAt?: string | null;
  id: string;
  gameId: string;
  playedAt: string;
  patternIds: string[];
  cpLoss: number;
  fast: boolean | null;
}

export interface LearningAttempt {
  id: string;
  anchor_key: string;
  source_game_id: string | null;
  position_id: string | null;
  mode: string;
  verdict: string | null;
  correct: boolean | null;
  used_hint: boolean;
  response_ms: number | null;
  created_at: string;
}

export interface LearningWindow {
  opportunities: number;
  games: number;
  errors: number;
  fast: number;
  timingKnown: number;
  errorRate: number | null;
  fastShare: number | null;
}

export interface PatternLearning {
  excludedChronologyGames: number;
  patternId: string;
  firstPracticedAt: string;
  practiceAttempts: number;
  practiceSuccesses: number;
  practiceWithHint: number;
  baseline: LearningWindow;
  subsequent: LearningWindow;
  errorRateChange: number | null;
}

export interface TransferCandidate {
  anchorKey: string;
  observationKey: string;
  sourceGameId: string;
  positionId: string;
  success: boolean;
}

function windowOf(rows: PatternObservation[]): LearningWindow {
  const games = new Set(rows.map((r) => r.gameId)).size;
  const errors = rows.filter((r) => r.cpLoss >= 100).length;
  const known = rows.filter((r) => r.fast !== null);
  const fast = known.filter((r) => r.fast).length;
  return {
    opportunities: rows.length, games, errors, fast, timingKnown: known.length,
    errorRate: rows.length >= 8 && games >= 3 ? errors / rows.length : null,
    fastShare: known.length >= 8 && new Set(known.map((r) => r.gameId)).size >= 3 ? fast / known.length : null,
  };
}

/** Only server-stamped evaluated attempts start the learning timeline. */
export function buildPatternLearning(observations: PatternObservation[], attempts: LearningAttempt[]): {
  patterns: PatternLearning[];
  transfers: TransferCandidate[];
} {
  const byPattern = new Map<string, LearningAttempt[]>();
  for (const attempt of new Map(attempts.map((a) => [a.id, a])).values()) {
    if (!["drill", "guided", "review"].includes(attempt.mode)
      || !["perfect", "ok", "wrong"].includes(attempt.verdict ?? "")
      || !Number.isFinite(Date.parse(attempt.created_at))) continue;
    const rows = byPattern.get(attempt.anchor_key) ?? [];
    rows.push(attempt);
    byPattern.set(attempt.anchor_key, rows);
  }
  const distinct = [...new Map(observations.map((o) => [o.id, o])).values()]
    .filter((o) => Number.isFinite(Date.parse(o.playedAt)) && Number.isFinite(o.cpLoss));
  const patterns: PatternLearning[] = [];
  const transfers: TransferCandidate[] = [];
  for (const [patternId, practice] of byPattern) {
    practice.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const first = practice[0];
    const firstMs = Date.parse(first.created_at);
    const trainingSources = new Set(practice.map((a) => a.source_game_id).filter(Boolean));
    const relevant = distinct.filter((o) => o.patternIds.includes(patternId));
    const before = relevant.filter((o) => Date.parse(o.playedAt) < firstMs);
    // Never count a position's training source as evidence of transfer.
    const endedLater = relevant.filter((o) => Date.parse(o.playedAt) > firstMs && !trainingSources.has(o.gameId));
    const after = endedLater.filter((o) => {
      const started = Date.parse(o.startedAt ?? "");
      return Number.isFinite(started) && started > firstMs && started <= Date.parse(o.playedAt);
    });
    const included = new Set(after.map((o) => o.id));
    const baseline = windowOf(before);
    const subsequent = windowOf(after);
    patterns.push({
      patternId, firstPracticedAt: first.created_at,
      excludedChronologyGames: new Set(endedLater.filter((o) => !included.has(o.id)).map((o) => o.gameId)).size,
      practiceAttempts: practice.length,
      practiceSuccesses: practice.filter((a) => a.correct === true).length,
      practiceWithHint: practice.filter((a) => a.used_hint).length,
      baseline, subsequent,
      errorRateChange: baseline.errorRate !== null && subsequent.errorRate !== null
        ? subsequent.errorRate - baseline.errorRate : null,
    });
    after.forEach((o) => transfers.push({
      anchorKey: patternId, observationKey: `pattern-v1:${o.id}`, sourceGameId: o.gameId,
      positionId: o.id, success: o.cpLoss < 100,
    }));
  }
  return { patterns, transfers };
}
