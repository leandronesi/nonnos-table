import type { TrainingMode, TrainingVerdict } from "../auth/db.types";
import type { SrsVerdict } from "../srs";
import type { TrainingAttemptInput } from "../trainingProgress";

export interface EvaluatedAttempt {
  anchorKey: string;
  sourceGameId?: string | null;
  positionId?: string | null;
  fenBefore?: string | null;
  mode: TrainingMode;
  verdict: TrainingVerdict | null;
  attempts: number;
  playedUci?: string | null;
  usedHint: boolean;
  responseMs?: number | null;
  maiaCurrentAcceptableObservedPolicy?: number | null;
  maiaTargetAcceptableObservedPolicy?: number | null;
  reasonCode: string;
  primaryAnchorKey?: string | null;
  corpusFallbackCode?: string | null;
  phaseNovelty?: string | null;
}

interface AttemptRecorderDependencies {
  recordLocal: (positionId: string, verdict: SrsVerdict) => unknown;
  recordCloud: (attempt: TrainingAttemptInput) => Promise<unknown>;
  reportCloudError: (error: unknown) => void;
}

/**
 * Creates a once-per-exercise recorder. Passive watch/skipped events are
 * deliberately ignored: only an evaluated guided/drill/review verdict can
 * change local SRS or cloud mastery.
 */
export function createEvaluatedAttemptRecorder(deps: AttemptRecorderDependencies) {
  const recorded = new Set<string>();

  return (attempt: EvaluatedAttempt): boolean => {
    const evaluatedMode = attempt.mode === "guided"
      || attempt.mode === "drill"
      || attempt.mode === "review";
    if (!evaluatedMode) return false;
    if (attempt.verdict !== "perfect"
      && attempt.verdict !== "ok"
      && attempt.verdict !== "wrong") return false;
    const verdict: SrsVerdict = attempt.verdict;

    const identity = attempt.positionId ?? attempt.sourceGameId ?? "unknown-position";
    const dedupeKey = `${attempt.mode}:${identity}`;
    if (recorded.has(dedupeKey)) return false;
    recorded.add(dedupeKey);

    deps.recordLocal(identity, verdict);
    void deps.recordCloud({
      anchorKey: attempt.anchorKey,
      sourceGameId: attempt.sourceGameId ?? null,
      positionId: attempt.positionId ?? null,
      mode: attempt.mode,
      attempts: Math.max(1, Math.trunc(attempt.attempts)),
      playedUci: attempt.playedUci ?? null,
      verdict,
      correct: verdict !== "wrong",
      usedHint: attempt.usedHint,
      responseMs: attempt.responseMs ?? null,
      maiaCurrentAcceptableObservedPolicy:
        attempt.maiaCurrentAcceptableObservedPolicy ?? null,
      maiaTargetAcceptableObservedPolicy:
        attempt.maiaTargetAcceptableObservedPolicy ?? null,
      context: {
        selection_reason: attempt.reasonCode,
        fen_before: attempt.fenBefore?.slice(0, 120) ?? null,
        primary_anchor_key: attempt.primaryAnchorKey ?? attempt.anchorKey,
        corpus_fallback: attempt.corpusFallbackCode ?? null,
        phase_novelty: attempt.phaseNovelty ?? null,
      },
    }).catch(deps.reportCloudError);
    return true;
  };
}
