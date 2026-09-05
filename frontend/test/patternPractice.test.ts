import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { gradePracticeMove, createPatternPractice, readPatternPractice, practiceAttemptInput, type PracticeResult } from "../src/session/patternPractice";
import type { BatchEvalResult } from "../src/pipeline/stockfishWorker";
import type { PersonalPattern, PatternOpportunity } from "../src/pipeline/personalPatterns";

const fen = new Chess().fen();
const position = { id: "game:21", gameId: "game", fen, kinds: ["narrow_choice"], timing: { spentSeconds: 2, clockBeforeSeconds: 300 }, timeClass: "rapid", baseSeconds: 600, incrementSeconds: 0 } as PatternOpportunity;
const pattern = { id: "narrow_choice:rapid:600:0:middlegame", examples: [position, { ...position, id: "duplicate", gameId: "other" }], successfulExamples: [] } as unknown as PersonalPattern;
const evaluation = (scoreCp: number | null, mate: number | null = null): BatchEvalResult => ({ scoreCp, mate, depth: 12, bestMoveUci: "e2e4", pvUci: null, lines: [] });

describe("pattern-specific practice", () => {
  it("deduplicates repeated board geometry, even when sourced from different games", () => {
    const state = createPatternPractice(pattern);
    expect(state.positions).toHaveLength(1);
    expect(state.phase).toBe("ready");
  });
  it("grades both sides' evaluations without treating a fast move as a mistake", () => {
    expect(gradePracticeMove(evaluation(60), evaluation(-60))).toEqual({ cpLoss: 0, verdict: "perfect" });
    expect(gradePracticeMove(evaluation(60), evaluation(100))).toEqual({ cpLoss: 160, verdict: "wrong" });
    expect(gradePracticeMove(evaluation(null, 3), evaluation(null, -2)).verdict).toBe("perfect");
    expect(() => gradePracticeMove(evaluation(null), evaluation(0))).toThrow();
    expect(() => gradePracticeMove({ ...evaluation(0), depth: 3 }, evaluation(0))).toThrow();
  });
  it("restores interrupted choices paused and rejects another pattern's session", () => {
    const state = { ...createPatternPractice(pattern), phase: "choosing", elapsedMs: 1234 };
    expect(readPatternPractice(JSON.stringify(state), pattern.id)).toMatchObject({ phase: "ready", elapsedMs: 1234 });
    expect(readPatternPractice(JSON.stringify(state), "different")).toBeNull();
    expect(readPatternPractice(JSON.stringify({ ...state, elapsedMs: -5 }), pattern.id)).toBeNull();
    expect(readPatternPractice("broken", pattern.id)).toBeNull();
  });
  it("preserves a pending attempt UUID, timing and source proof across retries", () => {
    const state = createPatternPractice(pattern);
    const result: PracticeResult = { attemptId: "00000000-0000-4000-8000-000000000001", positionId: position.id, playedUci: "e2e4", playedSan: "e4", resultingFen: fen, bestUci: "e2e4", cpLoss: 0, verdict: "perfect", responseMs: 2000, preparation: "ready", usedHint: false, savedAt: null };
    state.phase = "feedback"; state.results = [result];
    const restored = readPatternPractice(JSON.stringify(state), pattern.id)!;
    const input = practiceAttemptInput(restored, restored.results[0]);
    expect(input).toMatchObject({ clientAttemptId: result.attemptId, anchorKey: pattern.id, sourceGameId: "game", positionId: "game:21", responseMs: 2000, correct: true, context: { original_spent_seconds: 2, original_clock_before_seconds: 300 } });
    const long = practiceAttemptInput(state, { ...result, responseMs: 3_700_000 });
    expect(long).toMatchObject({ responseMs: null, context: { active_decision_ms: 3_700_000, response_clock_status: "outside_column_range" } });
  });
});
