import { describe, it, expect } from "vitest";
import { buildPatternLearning, type LearningAttempt, type PatternObservation } from "../src/pipeline/patternLearning";

const patternId = "time_reserve:rapid:600:0:middlegame";
const attempt: LearningAttempt = { id: "a", anchor_key: patternId, source_game_id: "training-source", position_id: "training-source:21", mode: "drill", verdict: "wrong", correct: false, used_hint: false, response_ms: 3000, created_at: "2026-08-15T12:00:00Z" };
function observation(game: string, date: string, patch: Partial<PatternObservation> = {}): PatternObservation {
  return { id: `${game}:21`, gameId: game, playedAt: date, startedAt: new Date(Date.parse(date) - 60_000).toISOString(), patternIds: [patternId], cpLoss: 150, fast: true, ...patch };
}

describe("practice to later-game transfer", () => {
  it("excludes overlapping games and unknown or invalid starts from later evidence", () => {
    const end = "2026-08-15T12:05:00Z";
    const cases = [
      observation("overlap", end, { startedAt: "2026-08-15T11:59:00Z" }),
      observation("equal", end, { startedAt: attempt.created_at }),
      observation("unknown", end, { startedAt: null }),
      observation("legacy", end, { startedAt: undefined }),
      observation("invalid", end, { startedAt: "2026-08-15T12:06:00Z" }),
      observation("after", end),
    ];
    const report = buildPatternLearning(cases, [attempt]);
    expect(report.patterns[0]).toMatchObject({ excludedChronologyGames: 5, subsequent: { games: 1, opportunities: 1 } });
    expect(report.transfers.map(row => row.sourceGameId)).toEqual(["after"]);
  });
  it("requires evaluated practice, excludes source games and respects chronology", () => {
    const before = observation("before", "2026-08-14T00:00:00Z");
    const exact = observation("exact", attempt.created_at);
    const after = observation("after", "2026-08-16T00:00:00Z", { cpLoss: 20 });
    const source = observation("training-source", "2026-08-17T00:00:00Z");
    const report = buildPatternLearning([before, exact, after, source, after], [attempt, attempt]);
    expect(report.patterns[0]).toMatchObject({ practiceAttempts: 1, practiceSuccesses: 0, baseline: { opportunities: 1 }, subsequent: { opportunities: 1, errors: 0 } });
    expect(report.transfers).toEqual([{ anchorKey: patternId, observationKey: "pattern-v1:after:21", sourceGameId: "after", positionId: "after:21", success: true }]);
    expect(buildPatternLearning([after], [{ ...attempt, mode: "watch" }]).transfers).toEqual([]);
    expect(buildPatternLearning([after], [{ ...attempt, verdict: "skipped" }]).transfers).toEqual([]);
  });

  it("never turns a small sample or no opportunities into a success rate", () => {
    const report = buildPatternLearning([], [attempt]);
    expect(report.patterns[0].subsequent.errorRate).toBeNull();
    expect(report.patterns[0].subsequent.fastShare).toBeNull();
    expect(report.patterns[0].errorRateChange).toBeNull();
  });

  it("keeps pacing distinct from move quality and compares the exact pattern scope", () => {
    const before = Array.from({ length: 9 }, (_, i) => observation(`old-${i % 3}`, "2026-08-14T00:00:00Z", { id: `before-${i}`, cpLoss: 150, fast: true }));
    const after = Array.from({ length: 9 }, (_, i) => observation(`new-${i % 3}`, "2026-08-16T00:00:00Z", { id: `after-${i}`, cpLoss: 0, fast: false }));
    const wrongCadence = observation("blitz", "2026-08-17T00:00:00Z", { patternIds: ["time_reserve:blitz:180:2:middlegame"] });
    const report = buildPatternLearning([...before, ...after, wrongCadence], [attempt]).patterns[0];
    expect(report.errorRateChange).toBe(-1);
    expect(report.baseline.fastShare).toBe(1);
    expect(report.subsequent.fastShare).toBe(0);
    expect(report.subsequent.opportunities).toBe(9);
  });
});
