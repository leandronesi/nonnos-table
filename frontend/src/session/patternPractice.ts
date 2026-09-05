import { Chess } from "chess.js";
import type { BatchEvalResult } from "../pipeline/stockfishWorker";
import type { PatternOpportunity, PersonalPattern } from "../pipeline/personalPatterns";
import type { TrainingAttemptInput } from "../trainingProgress";

export interface PracticeResult {
  attemptId: string;
  positionId: string;
  playedUci: string;
  playedSan: string;
  resultingFen: string;
  bestUci: string | null;
  replyUci?: string | null;
  bestLine?: string[];
  cpLoss: number;
  verdict: "perfect" | "ok" | "wrong";
  responseMs: number;
  preparation: "check" | "ready";
  usedHint: boolean;
  savedAt: string | null;
}

export interface PatternPracticeState {
  version: 1;
  patternId: string;
  positions: PatternOpportunity[];
  index: number;
  phase: "ready" | "choosing" | "feedback" | "complete";
  elapsedMs: number;
  preparation: "check" | "ready" | null;
  usedHint: boolean;
  results: PracticeResult[];
}

export function createPatternPractice(pattern: PersonalPattern): PatternPracticeState {
  const seen = new Set<string>();
  // Same geometry from different games is still the same exercise.
  const positions = [...pattern.examples, ...pattern.successfulExamples].filter((p) => {
    const key = p.fen.split(" ").slice(0, 4).join(" ");
    if (seen.has(key)) return false;
    try { if (new Chess(p.fen).isGameOver()) return false; } catch { return false; }
    seen.add(key);
    return true;
  }).slice(0, 5);
  return { version: 1, patternId: pattern.id, positions, index: 0, phase: "ready", elapsedMs: 0, preparation: null, usedHint: false, results: [] };
}

export function readPatternPractice(raw: string | null, patternId: string): PatternPracticeState | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as PatternPracticeState;
    if (state.version !== 1 || state.patternId !== patternId || !Array.isArray(state.positions)
      || !state.positions.length || state.positions.length > 5 || !Number.isInteger(state.index)
      || state.index < 0 || state.index >= state.positions.length || !Number.isFinite(state.elapsedMs)
      || state.elapsedMs < 0 || !["ready", "choosing", "feedback", "complete"].includes(state.phase)
      || !Array.isArray(state.results) || state.results.length > state.positions.length
      || ![null, "check", "ready"].includes(state.preparation) || typeof state.usedHint !== "boolean") return null;
    for (const p of state.positions) {
      if (!p || typeof p.id !== "string" || typeof p.gameId !== "string" || !p.timing || !Array.isArray(p.kinds)) return null;
      new Chess(p.fen);
    }
    for (const result of state.results) {
      if (!result || !/^[0-9a-f-]{36}$/i.test(result.attemptId) || !Number.isFinite(result.responseMs)
        || result.responseMs < 0 || !Number.isFinite(result.cpLoss)
        || !["perfect", "ok", "wrong"].includes(result.verdict)
        || !state.positions.some((p) => p.id === result.positionId)) return null;
      new Chess(result.resultingFen);
    }
    if ((state.phase === "feedback" || state.phase === "complete") && !state.results[state.index]) return null;
    // A reload never runs the decision timer before the player explicitly resumes.
    return state.phase === "choosing" ? { ...state, phase: "ready" } : state;
  } catch { return null; }
}

function score(result: BatchEvalResult): number {
  if (result.mate !== null) return result.mate > 0 ? 10000 : -10000;
  if (result.scoreCp === null || !Number.isFinite(result.scoreCp) || result.depth < 10) throw new Error("insufficient_engine_evidence");
  return result.scoreCp;
}

/** Both engine evaluations use side-to-move POV; the post-move sign is inverted. */
export function gradePracticeMove(before: BatchEvalResult, after: BatchEvalResult): Pick<PracticeResult, "cpLoss" | "verdict"> {
  const cpLoss = Math.min(1000, Math.max(0, score(before) + score(after)));
  return { cpLoss, verdict: cpLoss < 50 ? "perfect" : cpLoss < 100 ? "ok" : "wrong" };
}

export function practiceAttemptInput(state: PatternPracticeState, result: PracticeResult): TrainingAttemptInput {
  const position = state.positions.find((p) => p.id === result.positionId);
  if (!position) throw new Error("missing_practice_position");
  const responseMs = Math.round(result.responseMs);
  // The server's timing column admits at most one hour. Preserve longer
  // decisions in context rather than making the whole exercise unsaveable
  // or silently reporting a shorter decision.
  const timingInRange = Number.isFinite(responseMs) && responseMs >= 0 && responseMs <= 3_600_000;
  return {
    clientAttemptId: result.attemptId,
    anchorKey: state.patternId, sourceGameId: position.gameId, positionId: position.id,
    mode: "drill", attempts: 1, playedUci: result.playedUci, verdict: result.verdict,
    correct: result.verdict !== "wrong", usedHint: result.usedHint, responseMs: timingInRange ? responseMs : null,
    context: {
      pattern_version: 1, preparation: result.preparation,
      active_decision_ms: Number.isFinite(responseMs) ? responseMs : null,
      response_clock_status: timingInRange ? "recorded" : "outside_column_range",
      cp_loss: result.cpLoss, fen_before: position.fen,
      original_spent_seconds: position.timing.spentSeconds,
      original_clock_before_seconds: position.timing.clockBeforeSeconds,
      time_class: position.timeClass, base_seconds: position.baseSeconds,
      increment_seconds: position.incrementSeconds,
    },
  };
}
