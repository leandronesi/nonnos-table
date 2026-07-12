import type { PositionExample } from "../pipeline/aggregate";
import {
  anchorKeyForPosition,
  stableFenKey,
  stablePositionId,
  type AdaptiveSessionSelection,
  type PositionNovelty,
  type SessionPhaseKey,
} from "./adaptiveSelector";
import { todayUTC, type SessionState } from "./store";

export type PersistedAdaptiveSelection = AdaptiveSessionSelection<PositionExample>;

const PHASES: readonly SessionPhaseKey[] = ["review", "guided", "solo"];

/** A frozen session remains usable even when a background aggregate refresh fails. */
export function shouldBlockAggregateRefreshFailure(hasRestoredSelection: boolean): boolean {
  return !hasRestoredSelection;
}

function fallbackLabel(anchorKey: string): string {
  return anchorKey.replace(/^(anchor|motif):/, "").replace(/_/g, " ");
}

function samePosition(left: PositionExample, right: PositionExample): boolean {
  return stablePositionId(left) === stablePositionId(right)
    || stableFenKey(left.fen_before) === stableFenKey(right.fen_before);
}

function isPositionSnapshot(value: unknown): value is PositionExample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.source_game_id === "string"
    && typeof row.position_id === "string"
    && typeof row.fen_before === "string"
    && typeof row.ply === "number"
    && (row.color === "white" || row.color === "black")
    && typeof row.phase === "string"
    && typeof row.san === "string"
    && typeof row.played_uci === "string"
    && (typeof row.best_uci === "string" || row.best_uci === null)
    && typeof row.cp_loss === "number"
    && typeof row.score_before_cp === "number"
    && typeof row.score_after_cp === "number"
    && (row.category === "blunder" || row.category === "mistake");
}

/** Rebuilds the exact persisted choice and rejects stale anchor mappings. */
export function restoreAdaptiveSelection(
  positions: readonly PositionExample[],
  stored: SessionState | null,
  date = todayUTC(),
): PersistedAdaptiveSelection | null {
  if (!stored || stored.date !== date || !stored.anchorKey) return null;
  if (!stored.temaPositionId || !stored.warmupPositionId || !stored.drillPositionId) return null;

  const byId = new Map(positions.map((position) => [stablePositionId(position), position]));
  const fromSnapshot = (phase: SessionPhaseKey, expectedId: string): PositionExample | undefined => {
    const snapshot = stored.positionSnapshots?.[phase];
    return isPositionSnapshot(snapshot) && stablePositionId(snapshot) === expectedId
      ? snapshot
      : undefined;
  };
  // Prefer the frozen schema-6 snapshot even when refreshed aggregates contain
  // the same id with newly computed fields.
  const review = fromSnapshot("review", stored.temaPositionId)
    ?? byId.get(stored.temaPositionId);
  const guided = fromSnapshot("guided", stored.warmupPositionId)
    ?? byId.get(stored.warmupPositionId);
  const solo = fromSnapshot("solo", stored.drillPositionId)
    ?? byId.get(stored.drillPositionId);
  if (!review || !guided || !solo) return null;

  const positionsByPhase = { review, guided, solo } as const;
  const anchorLabel = stored.anchorLabel ?? fallbackLabel(stored.anchorKey);
  const phaseAnchors = Object.fromEntries(PHASES.map((phase) => {
    const position = positionsByPhase[phase];
    const anchorKey = stored.phaseAnchorKeys?.[phase] ?? anchorKeyForPosition(position);
    return [phase, {
      anchorKey,
      anchorLabel: stored.phaseAnchorLabels?.[phase]
        ?? (anchorKey === stored.anchorKey ? anchorLabel : fallbackLabel(anchorKey)),
    }];
  })) as PersistedAdaptiveSelection["phaseAnchors"];

  if (PHASES.some(
    (phase) => anchorKeyForPosition(positionsByPhase[phase]) !== phaseAnchors[phase].anchorKey,
  )) return null;

  const uniquePositions: PositionExample[] = [];
  for (const phase of PHASES) {
    const position = positionsByPhase[phase];
    if (!uniquePositions.some((existing) => samePosition(existing, position))) {
      uniquePositions.push(position);
    }
  }
  const distinctPositions = uniquePositions.length;

  const phaseNovelty = { ...(stored.phaseNovelty ?? {}) } as Record<SessionPhaseKey, PositionNovelty>;
  const priorPositions: PositionExample[] = [];
  for (const phase of PHASES) {
    const position = positionsByPhase[phase];
    const repeated = priorPositions.some((existing) => samePosition(existing, position));
    phaseNovelty[phase] = repeated
      ? "reused_in_session"
      : phaseNovelty[phase] ?? "recent";
    priorPositions.push(position);
  }

  const storedSupplemental = new Map(
    (stored.supplementalAnchorKeys ?? []).map((anchorKey, index) => [anchorKey, {
      anchorKey,
      anchorLabel: stored.supplementalAnchorLabels?.[index] ?? fallbackLabel(anchorKey),
    }]),
  );
  const supplementalAnchors = PHASES.reduce<PersistedAdaptiveSelection["supplementalAnchors"]>(
    (result, phase) => {
      const actual = phaseAnchors[phase];
      if (actual.anchorKey === stored.anchorKey
        || result.some((anchor) => anchor.anchorKey === actual.anchorKey)) return result;
      result.push(storedSupplemental.get(actual.anchorKey) ?? actual);
      return result;
    },
    [],
  );
  const secondaryAnchor = supplementalAnchors[0] ?? null;
  const fallbackCode = secondaryAnchor
    ? "secondary_anchor"
    : distinctPositions < 3
      ? "position_reuse"
      : stored.corpusFallbackCode ?? null;

  return {
    anchorKey: stored.anchorKey,
    anchorLabel,
    review,
    guided,
    solo,
    distinctPositions,
    reusedPosition: distinctPositions < 3,
    phaseAnchors,
    phaseNovelty,
    secondaryAnchor,
    supplementalAnchors,
    corpusFallback: fallbackCode
      ? {
          code: fallbackCode,
          primaryPositionsAvailable: stored.corpusPrimaryPositionsAvailable
            ?? PHASES.filter((phase) => phaseAnchors[phase].anchorKey === stored.anchorKey).length,
          secondaryAnchorKey: secondaryAnchor?.anchorKey ?? null,
          secondaryAnchorLabel: secondaryAnchor?.anchorLabel ?? null,
        }
      : null,
    difficultyProgression: stored.difficultyProgression ?? (
      secondaryAnchor ? "secondary_fallback" : distinctPositions < 3 ? "limited_corpus" : "ascending"
    ),
    whyToday: {
      code: stored.whyTodayCode ?? "fallback",
      anchorKey: stored.anchorKey,
      anchorLabel,
      currentSupport: stored.whyCurrentSupport === true,
      targetRelevant: stored.whyTargetRelevant === true,
      relativePriority: stored.whyRelativePriority ?? null,
      nextReviewAt: stored.whyNextReviewAt ?? null,
      observedWrongAttempts: stored.whyObservedWrongAttempts ?? 0,
      observedHintUses: stored.whyObservedHintUses ?? 0,
    },
  };
}
