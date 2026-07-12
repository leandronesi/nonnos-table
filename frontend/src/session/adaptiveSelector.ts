/**
 * Pure daily-session selector.
 *
 * The selector knows nothing about React, storage or Supabase.  Given the same
 * candidates, mastery snapshots, recent attempts, clock and seed it returns the
 * same session.  This keeps the product decision inspectable and testable.
 */

export interface SelectableSessionPosition {
  position_id?: string | null;
  source_game_id?: string | null;
  fen_before: string;
  ply: number;
  error_type?: string | null;
  motif?: string | null;
  cp_loss?: number | null;
  priority_score?: number | null;
  training_priority_weight?: number | null;
  stockfish_choice_gap?: number | null;
  move_difficulty?: number | null;
  maia_target_acceptable_observed_difficulty?: number | null;
  avoidable_at_current?: boolean | null;
  target_relevant?: boolean | null;
}

export interface SessionAnchorPriority {
  anchorKey: string;
  label?: string | null;
  relativePriority?: number | null;
  weightedScore?: number | null;
}

export interface SessionAnchorMastery {
  anchorKey: string;
  status: "candidate" | "practicing" | "review" | "mastered";
  masteryScore: number;
  nextReviewAt?: string | null;
}

export interface RecentSessionAttempt {
  anchorKey: string;
  positionId?: string | null;
  sourceGameId?: string | null;
  fenBefore?: string | null;
  mode?: "watch" | "guided" | "drill" | "review" | "game_transfer" | null;
  verdict?: "perfect" | "ok" | "wrong" | "skipped" | null;
  correct?: boolean | null;
  usedHint?: boolean;
  attempts?: number | null;
  nextDueAt?: string | null;
  createdAt: string;
}

export type WhyTodayCode =
  | "focus_override"
  | "review_due"
  | "low_mastery"
  | "recent_errors"
  | "hint_dependency"
  | "priority_pattern"
  | "current_support"
  | "target_relevance"
  | "fallback";

export interface WhyToday {
  code: WhyTodayCode;
  anchorKey: string;
  anchorLabel: string;
  currentSupport: boolean;
  targetRelevant: boolean;
  relativePriority: number | null;
  nextReviewAt: string | null;
  /** Conteggi di eventi registrati, non diagnosi causali. */
  observedWrongAttempts: number;
  observedHintUses: number;
}

export type SessionPhaseKey = "review" | "guided" | "solo";
export type PositionNovelty = "fresh" | "due" | "recent" | "reused_in_session";
export type CorpusFallbackCode = "secondary_anchor" | "position_reuse";

export interface PhaseAnchor {
  anchorKey: string;
  anchorLabel: string;
}

export interface CorpusFallback {
  code: CorpusFallbackCode;
  primaryPositionsAvailable: number;
  secondaryAnchorKey: string | null;
  secondaryAnchorLabel: string | null;
}

export interface AdaptiveSessionSelection<T extends SelectableSessionPosition> {
  anchorKey: string;
  anchorLabel: string;
  review: T;
  guided: T;
  solo: T;
  whyToday: WhyToday;
  distinctPositions: number;
  /** Honest UI copy is required whenever this is true. */
  reusedPosition: boolean;
  /** Ancora effettiva di ogni fase: evita di fingere un unico tema nel fallback. */
  phaseAnchors: Record<SessionPhaseKey, PhaseAnchor>;
  phaseNovelty: Record<SessionPhaseKey, PositionNovelty>;
  secondaryAnchor: PhaseAnchor | null;
  supplementalAnchors: PhaseAnchor[];
  corpusFallback: CorpusFallback | null;
  difficultyProgression: "ascending" | "focus_override" | "evidence_first" | "secondary_fallback" | "limited_corpus";
}

export interface AdaptiveSessionInput<T extends SelectableSessionPosition> {
  positions: readonly T[];
  priorities?: readonly SessionAnchorPriority[];
  mastery?: readonly SessionAnchorMastery[];
  recentAttempts?: readonly RecentSessionAttempt[];
  /** Position id, legacy `${fen}:${ply}`, or a canonical anchor key. */
  focusKey?: string | null;
  /** Stable per user/day, for deterministic daily rotation. */
  seed: string;
  nowMs: number;
}

interface AnchorGroup<T extends SelectableSessionPosition> {
  anchorKey: string;
  positions: T[];
  label: string;
  hasPriorityEvidence: boolean;
  relativePriority: number;
  weightedScore: number;
  mastery: SessionAnchorMastery | null;
  due: boolean;
  lowMastery: boolean;
  recentlyPractised: boolean;
  mostRecentAttemptMs: number;
  observedWrongAttempts: number;
  observedHintUses: number;
  extraAttempts: number;
  currentSupport: boolean;
  targetRelevant: boolean;
}

const MS_PER_DAY = 86_400_000;
const ANCHOR_COOLDOWN_MS = 7 * MS_PER_DAY;
const POSITION_COOLDOWN_MS = 14 * MS_PER_DAY;
const STRUGGLE_WINDOW_MS = 30 * MS_PER_DAY;
const LOCAL_CLOUD_MATCH_TOLERANCE_MS = 5 * 60_000;
const LOW_MASTERY_THRESHOLD = 0.6;

function normalizedToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 140);
}

/** Canonical product key: error taxonomy first, observed motif only as fallback. */
export function anchorKeyForPosition(position: SelectableSessionPosition): string {
  const errorType = position.error_type?.trim();
  if (errorType) {
    return errorType.startsWith("anchor:")
      ? errorType
      : `anchor:${normalizedToken(errorType)}`;
  }
  const motif = position.motif?.trim();
  if (motif) {
    return motif.startsWith("motif:")
      ? motif
      : `motif:${normalizedToken(motif)}`;
  }
  return "anchor:unclassified_error";
}

export function stablePositionId(position: SelectableSessionPosition): string {
  if (position.position_id?.trim()) return position.position_id.trim();
  if (position.source_game_id?.trim()) {
    return `${position.source_game_id.trim()}:${position.ply}`;
  }
  return `${position.fen_before}:${position.ply}`;
}

/** Board identity without halfmove/fullmove counters. */
export function stableFenKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

function attemptsReferToSamePosition(
  left: RecentSessionAttempt,
  right: RecentSessionAttempt,
): boolean {
  if (left.positionId && right.positionId && left.positionId === right.positionId) return true;
  return Boolean(
    left.fenBefore
    && right.fenBefore
    && stableFenKey(left.fenBefore) === stableFenKey(right.fenBefore),
  );
}

/**
 * Local SRS is a latest-attempt snapshot and cloud history contains events.
 * Prefer the cloud event when it is at least as recent (allowing modest clock
 * skew); retain a newer local snapshot so an offline attempt is not lost.
 */
export function mergeRecentSessionAttempts(
  localSnapshots: readonly RecentSessionAttempt[],
  cloudEvents: readonly RecentSessionAttempt[],
): RecentSessionAttempt[] {
  const unmatchedLocal = localSnapshots.filter((local) => {
    const localAt = parseDate(local.createdAt);
    if (!Number.isFinite(localAt)) return true;
    return !cloudEvents.some((cloud) => {
      if (!attemptsReferToSamePosition(local, cloud)) return false;
      const cloudAt = parseDate(cloud.createdAt);
      return Number.isFinite(cloudAt)
        && cloudAt >= localAt - LOCAL_CLOUD_MATCH_TOLERANCE_MS;
    });
  });
  return [...cloudEvents, ...unmatchedLocal];
}

function focusMatches<T extends SelectableSessionPosition>(position: T, focusKey: string): boolean {
  return position.position_id === focusKey
    || stablePositionId(position) === focusKey
    || `${position.fen_before}:${position.ply}` === focusKey;
}

function displayLabel(anchorKey: string): string {
  const raw = anchorKey.replace(/^(anchor|motif):/, "").replace(/_/g, " ");
  return raw.length > 0 ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Posizione";
}

/** Small stable hash used only as a deterministic tie-breaker. */
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseDate(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function compareNumbersDesc(a: number, b: number): number {
  return b - a;
}

function chooseReason<T extends SelectableSessionPosition>(
  group: AnchorGroup<T>,
  focusForced: boolean,
): WhyTodayCode {
  if (focusForced) return "focus_override";
  if (group.due) return "review_due";
  if (group.lowMastery) return "low_mastery";
  if (group.observedWrongAttempts > 0) return "recent_errors";
  if (group.observedHintUses > 0) return "hint_dependency";
  if (group.hasPriorityEvidence) return "priority_pattern";
  if (group.currentSupport) return "current_support";
  if (group.targetRelevant) return "target_relevance";
  return "fallback";
}

function candidateQuality(position: SelectableSessionPosition): number {
  const explicit = finiteOrZero(position.training_priority_weight);
  const priority = finiteOrZero(position.priority_score) / 3;
  const impact = Math.log1p(Math.max(0, finiteOrZero(position.cp_loss))) / 10;
  return explicit * 10 + priority + impact;
}

function noveltyScore<T extends SelectableSessionPosition>(candidate: T, selected: readonly T[]): number {
  const ids = new Set(selected.map(stablePositionId));
  const fens = new Set(selected.map((p) => stableFenKey(p.fen_before)));
  const games = new Set(selected.map((p) => p.source_game_id).filter(Boolean));
  let score = 0;
  if (!ids.has(stablePositionId(candidate))) score += 100;
  if (!fens.has(stableFenKey(candidate.fen_before))) score += 20;
  if (!candidate.source_game_id || !games.has(candidate.source_game_id)) score += 5;
  return score;
}

interface PositionHistory {
  lastSeenMs: number;
  due: boolean;
  wrongAttempts: number;
  hintUses: number;
  extraAttempts: number;
}

interface ChosenPosition<T extends SelectableSessionPosition> {
  position: T;
  novelty: PositionNovelty;
  difficulty: number;
}

function attemptMatchesPosition(
  attempt: RecentSessionAttempt,
  position: SelectableSessionPosition,
): boolean {
  const stableId = stablePositionId(position);
  const legacyId = `${position.fen_before}:${position.ply}`;
  if (attempt.positionId && (attempt.positionId === stableId || attempt.positionId === legacyId)) {
    return true;
  }
  if (attempt.fenBefore && stableFenKey(attempt.fenBefore) === stableFenKey(position.fen_before)) {
    return true;
  }
  return false;
}

function historyForPosition(
  position: SelectableSessionPosition,
  attempts: readonly RecentSessionAttempt[],
  nowMs: number,
): PositionHistory {
  let lastSeenMs = 0;
  let due = false;
  let wrongAttempts = 0;
  let hintUses = 0;
  let extraAttempts = 0;

  for (const attempt of attempts) {
    const attemptedAt = parseDate(attempt.createdAt);
    const samePosition = attemptMatchesPosition(attempt, position);
    const sameGame = Boolean(
      position.source_game_id
      && attempt.sourceGameId === position.source_game_id,
    );
    if ((samePosition || sameGame) && Number.isFinite(attemptedAt)) {
      lastSeenMs = Math.max(lastSeenMs, attemptedAt);
    }
    if (!samePosition) continue;
    const nextDueMs = parseDate(attempt.nextDueAt);
    if (Number.isFinite(nextDueMs) && nextDueMs <= nowMs) due = true;
    if (!Number.isFinite(attemptedAt) || attemptedAt < nowMs - STRUGGLE_WINDOW_MS) continue;
    if (attempt.verdict === "wrong" || attempt.correct === false) wrongAttempts++;
    if (attempt.usedHint === true) hintUses++;
    extraAttempts += Math.max(0, Math.trunc(attempt.attempts ?? 1) - 1);
  }
  return { lastSeenMs, due, wrongAttempts, hintUses, extraAttempts };
}

function positionDifficulty(position: SelectableSessionPosition): number {
  const maia = finiteOrZero(position.maia_target_acceptable_observed_difficulty);
  const stockfish = finiteOrZero(
    position.stockfish_choice_gap ?? position.move_difficulty,
  );
  const impact = Math.log1p(Math.max(0, finiteOrZero(position.cp_loss))) / 12;
  return maia * 4 + stockfish * 2 + impact;
}

function rotationOffset(seed: string, scope: string, nowMs: number, length: number): number {
  if (length <= 1) return 0;
  const identitySeed = seed.replace(/\d{4}-\d{2}-\d{2}/g, "day");
  const dayNumber = Math.floor(nowMs / MS_PER_DAY);
  return (hash(`${identitySeed}:${scope}`) + dayNumber) % length;
}

function rotate<T>(items: readonly T[], offset: number): T[] {
  if (items.length <= 1) return [...items];
  const normalized = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function dedupePositions<T extends SelectableSessionPosition>(
  positions: readonly T[],
  preferredPosition: T | null = null,
): T[] {
  const ids = new Set<string>();
  const fens = new Set<string>();
  return [...positions]
    .sort((a, b) => {
      if (preferredPosition) {
        const preferredId = stablePositionId(preferredPosition);
        const aPreferred = stablePositionId(a) === preferredId;
        const bPreferred = stablePositionId(b) === preferredId;
        if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
      }
      const quality = compareNumbersDesc(candidateQuality(a), candidateQuality(b));
      return quality !== 0
        ? quality
        : stablePositionId(a).localeCompare(stablePositionId(b));
    })
    .filter((position) => {
      const id = stablePositionId(position);
      const fen = stableFenKey(position.fen_before);
      if (ids.has(id) || fens.has(fen)) return false;
      ids.add(id);
      fens.add(fen);
      return true;
    });
}

function selectDistinctPositions<T extends SelectableSessionPosition>(input: {
  positions: readonly T[];
  attempts: readonly RecentSessionAttempt[];
  focusPosition: T | null;
  seed: string;
  nowMs: number;
  count: number;
  scope: string;
  requiredEvidence?: "due" | "wrong" | "hint" | null;
}): ChosenPosition<T>[] {
  const unique = dedupePositions(input.positions, input.focusPosition);
  const annotated = unique.map((position) => ({
    position,
    history: historyForPosition(position, input.attempts, input.nowMs),
    difficulty: positionDifficulty(position),
  }));
  const evidenceCandidates = input.focusPosition || !input.requiredEvidence
    ? []
    : annotated.filter((candidate) => {
        if (input.requiredEvidence === "due") return candidate.history.due;
        if (input.requiredEvidence === "wrong") return candidate.history.wrongAttempts > 0;
        return candidate.history.hintUses > 0 || candidate.history.extraAttempts > 0;
      }).sort((a, b) => {
        const evidenceA = a.history.wrongAttempts * 4
          + a.history.hintUses * 2
          + a.history.extraAttempts;
        const evidenceB = b.history.wrongAttempts * 4
          + b.history.hintUses * 2
          + b.history.extraAttempts;
        if (evidenceA !== evidenceB) return evidenceB - evidenceA;
        if (a.history.lastSeenMs !== b.history.lastSeenMs) {
          return a.history.lastSeenMs - b.history.lastSeenMs;
        }
        const quality = compareNumbersDesc(
          candidateQuality(a.position),
          candidateQuality(b.position),
        );
        if (quality !== 0) return quality;
        return hash(`${input.seed}:${stablePositionId(a.position)}`)
          - hash(`${input.seed}:${stablePositionId(b.position)}`);
      });
  const requiredCandidate = evidenceCandidates[0] ?? null;
  const reservedCount = input.focusPosition || requiredCandidate ? 1 : 0;
  const fresh = annotated.filter(
    (candidate) => candidate.history.lastSeenMs < input.nowMs - POSITION_COOLDOWN_MS,
  );
  // Hard novelty rule: if enough non-recent alternatives exist, recent items
  // cannot enter this session. A focus selected by the user is the only override.
  const freshAlternatives = requiredCandidate
    ? fresh.filter(
        (candidate) => stablePositionId(candidate.position)
          !== stablePositionId(requiredCandidate.position),
      )
    : fresh;
  const basePool = freshAlternatives.length >= Math.max(0, input.count - reservedCount)
    && !input.focusPosition
    ? requiredCandidate
      ? [requiredCandidate, ...freshAlternatives]
      : freshAlternatives
    : annotated;

  const tierFor = (candidate: typeof annotated[number]): number => {
    const isFresh = candidate.history.lastSeenMs < input.nowMs - POSITION_COOLDOWN_MS;
    if (isFresh) return 0;
    if (candidate.history.due) return 1;
    if (candidate.history.wrongAttempts > 0) return 2;
    if (candidate.history.hintUses > 0 || candidate.history.extraAttempts > 0) return 3;
    return 4;
  };
  const tiered = [...basePool].sort((a, b) => {
    const freshA = a.history.lastSeenMs < input.nowMs - POSITION_COOLDOWN_MS;
    const freshB = b.history.lastSeenMs < input.nowMs - POSITION_COOLDOWN_MS;
    if (freshA !== freshB) return freshA ? -1 : 1;
    if (a.history.due !== b.history.due) return a.history.due ? -1 : 1;
    const struggleA = a.history.wrongAttempts * 4
      + a.history.hintUses * 2
      + a.history.extraAttempts;
    const struggleB = b.history.wrongAttempts * 4
      + b.history.hintUses * 2
      + b.history.extraAttempts;
    if (struggleA !== struggleB) return struggleB - struggleA;
    const quality = compareNumbersDesc(
      candidateQuality(a.position),
      candidateQuality(b.position),
    );
    if (quality !== 0) return quality;
    return stablePositionId(a.position).localeCompare(stablePositionId(b.position));
  });
  const ranked: typeof tiered = [];
  for (const tier of [...new Set(tiered.map(tierFor))].sort((a, b) => a - b)) {
    const inTier = tiered.filter((candidate) => tierFor(candidate) === tier);
    ranked.push(...rotate(
      inTier,
      rotationOffset(input.seed, `${input.scope}:tier:${tier}`, input.nowMs, inTier.length),
    ));
  }

  const selected: typeof annotated = [];
  if (input.focusPosition) {
    const focused = annotated.find(
      (candidate) => stablePositionId(candidate.position) === stablePositionId(input.focusPosition!),
    );
    if (focused) selected.push(focused);
  } else if (requiredCandidate) {
    selected.push(requiredCandidate);
  }

  while (selected.length < Math.min(input.count, annotated.length)) {
    const remaining = ranked.filter(
      (candidate) => !selected.some(
        (chosen) => stablePositionId(chosen.position) === stablePositionId(candidate.position),
      ),
    );
    if (remaining.length === 0) break;
    remaining.sort((a, b) => {
      const novelty = noveltyScore(
        b.position,
        selected.map((item) => item.position),
      ) - noveltyScore(
        a.position,
        selected.map((item) => item.position),
      );
      if (novelty !== 0) return novelty;
      return ranked.indexOf(a) - ranked.indexOf(b);
    });
    selected.push(remaining[0]);
  }

  return selected.map((candidate) => ({
    position: candidate.position,
    novelty: candidate.history.due
      ? "due"
      : candidate.history.lastSeenMs >= input.nowMs - POSITION_COOLDOWN_MS
        ? "recent"
        : "fresh",
    difficulty: candidate.difficulty,
  }));
}

export function selectAdaptiveSession<T extends SelectableSessionPosition>(
  input: AdaptiveSessionInput<T>,
): AdaptiveSessionSelection<T> | null {
  if (input.positions.length === 0) return null;

  const priorities = new Map(input.priorities?.map((row) => [row.anchorKey, row]) ?? []);
  const mastery = new Map(input.mastery?.map((row) => [row.anchorKey, row]) ?? []);
  const attempts = input.recentAttempts ?? [];
  const grouped = new Map<string, T[]>();
  for (const position of input.positions) {
    const key = anchorKeyForPosition(position);
    const values = grouped.get(key) ?? [];
    values.push(position);
    grouped.set(key, values);
  }

  const focusPosition = input.focusKey
    ? input.positions.find((position) => focusMatches(position, input.focusKey!)) ?? null
    : null;
  const focusAnchor = focusPosition
    ? anchorKeyForPosition(focusPosition)
    : input.focusKey && grouped.has(input.focusKey)
      ? input.focusKey
      : null;

  const groups: AnchorGroup<T>[] = [];
  for (const [anchorKey, positions] of grouped) {
    const priority = priorities.get(anchorKey);
    const masteryRow = mastery.get(anchorKey) ?? null;
    const nextReviewMs = parseDate(masteryRow?.nextReviewAt);
    const anchorAttempts = attempts.filter((attempt) => attempt.anchorKey === anchorKey);
    const localReviewDue = anchorAttempts.some((attempt) => {
      const dueAt = parseDate(attempt.nextDueAt);
      return Number.isFinite(dueAt) && dueAt <= input.nowMs;
    });
    const due = masteryRow?.status !== "mastered"
      && ((masteryRow?.status === "review" && !Number.isFinite(nextReviewMs))
        || (Number.isFinite(nextReviewMs) && nextReviewMs <= input.nowMs)
        || localReviewDue);
    const lowMastery = masteryRow != null
      && masteryRow.status !== "mastered"
      && masteryRow.masteryScore < LOW_MASTERY_THRESHOLD;
    const mostRecentAttemptMs = anchorAttempts.reduce(
      (latest, attempt) => Math.max(latest, parseDate(attempt.createdAt) || 0),
      0,
    );
    const struggleAttempts = anchorAttempts.filter((attempt) => {
      const at = parseDate(attempt.createdAt);
      return Number.isFinite(at) && at >= input.nowMs - STRUGGLE_WINDOW_MS;
    });
    const observedWrongAttempts = struggleAttempts.filter(
      (attempt) => attempt.verdict === "wrong" || attempt.correct === false,
    ).length;
    const observedHintUses = struggleAttempts.filter(
      (attempt) => attempt.usedHint === true,
    ).length;
    const extraAttempts = struggleAttempts.reduce(
      (sum, attempt) => sum + Math.max(0, Math.trunc(attempt.attempts ?? 1) - 1),
      0,
    );
    const fallbackWeight = positions.reduce(
      (sum, position) => sum + candidateQuality(position),
      0,
    );
    groups.push({
      anchorKey,
      positions,
      label: priority?.label?.trim() || displayLabel(anchorKey),
      hasPriorityEvidence: finiteOrZero(priority?.weightedScore) > 0
        || finiteOrZero(priority?.relativePriority) > 0,
      relativePriority: finiteOrZero(priority?.relativePriority),
      weightedScore: priority?.weightedScore == null
        ? fallbackWeight
        : finiteOrZero(priority.weightedScore),
      mastery: masteryRow,
      due,
      lowMastery,
      recentlyPractised: mostRecentAttemptMs >= input.nowMs - ANCHOR_COOLDOWN_MS,
      mostRecentAttemptMs,
      observedWrongAttempts,
      observedHintUses,
      extraAttempts,
      currentSupport: positions.some((position) => position.avoidable_at_current === true),
      targetRelevant: positions.some((position) => position.target_relevant === true),
    });
  }

  let eligible = groups;
  if (focusAnchor) {
    eligible = groups.filter((group) => group.anchorKey === focusAnchor);
  } else {
    const nonMastered = groups.filter((group) => group.mastery?.status !== "mastered");
    if (nonMastered.length > 0) eligible = nonMastered;
  }

  const compareGroups = (a: AnchorGroup<T>, b: AnchorGroup<T>): number => {
    if (a.due !== b.due) return a.due ? -1 : 1;
    if (a.due && b.due) {
      const aDue = parseDate(a.mastery?.nextReviewAt);
      const bDue = parseDate(b.mastery?.nextReviewAt);
      if (Number.isFinite(aDue) && Number.isFinite(bDue) && aDue !== bDue) return aDue - bDue;
    }
    if (a.lowMastery !== b.lowMastery) return a.lowMastery ? -1 : 1;
    if (a.lowMastery && b.lowMastery) {
      const masteryDelta = a.mastery!.masteryScore - b.mastery!.masteryScore;
      if (masteryDelta !== 0) return masteryDelta;
    }
    if (a.observedWrongAttempts !== b.observedWrongAttempts) {
      return b.observedWrongAttempts - a.observedWrongAttempts;
    }
    if (a.observedHintUses !== b.observedHintUses) {
      return b.observedHintUses - a.observedHintUses;
    }
    if (a.extraAttempts !== b.extraAttempts) {
      return b.extraAttempts - a.extraAttempts;
    }
    // A due/weak anchor still wins; otherwise rotate away from yesterday's work.
    if (!a.due && !b.due && !a.lowMastery && !b.lowMastery
      && a.recentlyPractised !== b.recentlyPractised) {
      return a.recentlyPractised ? 1 : -1;
    }
    const weighted = compareNumbersDesc(a.weightedScore, b.weightedScore);
    if (weighted !== 0) return weighted;
    const relative = compareNumbersDesc(a.relativePriority, b.relativePriority);
    if (relative !== 0) return relative;
    if (a.mostRecentAttemptMs !== b.mostRecentAttemptMs) {
      return a.mostRecentAttemptMs - b.mostRecentAttemptMs;
    }
    return hash(`${input.seed}:${a.anchorKey}`) - hash(`${input.seed}:${b.anchorKey}`);
  };
  eligible.sort(compareGroups);

  const chosen = eligible[0];
  if (!chosen) return null;
  const chosenReason = chooseReason(chosen, focusAnchor != null);
  const requiredEvidence = chosenReason === "review_due"
    ? "due"
    : chosenReason === "recent_errors"
      ? "wrong"
      : chosenReason === "hint_dependency"
        ? "hint"
        : null;

  const focusedInChosen = focusPosition
    && anchorKeyForPosition(focusPosition) === chosen.anchorKey
    ? focusPosition
    : null;
  const primaryAvailable = dedupePositions(chosen.positions);
  let primarySelection = selectDistinctPositions({
    positions: chosen.positions,
    // Position/FEN/source-game novelty is global: a position from a game seen
    // under another anchor is still not new to the player.
    attempts,
    focusPosition: focusedInChosen,
    seed: input.seed,
    nowMs: input.nowMs,
    count: Math.min(3, primaryAvailable.length),
    scope: chosen.anchorKey,
    requiredEvidence,
  });
  const firstHistory = primarySelection[0]
    ? historyForPosition(primarySelection[0].position, attempts, input.nowMs)
    : null;
  const evidenceFirst = Boolean(firstHistory && (
    (requiredEvidence === "due" && firstHistory.due)
    || (requiredEvidence === "wrong" && firstHistory.wrongAttempts > 0)
    || (requiredEvidence === "hint"
      && (firstHistory.hintUses > 0 || firstHistory.extraAttempts > 0))
  ));
  if ((focusedInChosen || evidenceFirst) && primarySelection.length > 1) {
    primarySelection = [
      primarySelection[0],
      ...primarySelection.slice(1).sort((a, b) => a.difficulty - b.difficulty),
    ];
  } else {
    primarySelection.sort((a, b) => a.difficulty - b.difficulty);
  }

  const supplementalGroups: AnchorGroup<T>[] = [];
  let secondarySelection: ChosenPosition<T>[] = [];
  if (primarySelection.length < 3) {
    const allSecondary = groups.filter((group) => group.anchorKey !== chosen.anchorKey);
    const nonMasteredSecondary = allSecondary.filter(
      (group) => group.mastery?.status !== "mastered",
    );
    const secondaryCandidates = (
      nonMasteredSecondary.length > 0 ? nonMasteredSecondary : allSecondary
    ).sort(compareGroups);
    for (const supplemental of secondaryCandidates) {
      const alreadySelected = [...primarySelection, ...secondarySelection];
      const usedIds = new Set(alreadySelected.map((item) => stablePositionId(item.position)));
      const usedFens = new Set(
        alreadySelected.map((item) => stableFenKey(item.position.fen_before)),
      );
      const usedGames = new Set(
        alreadySelected
          .map((item) => item.position.source_game_id)
          .filter((value): value is string => Boolean(value)),
      );
      const distinctSecondary = supplemental.positions.filter(
        (position) => !usedIds.has(stablePositionId(position))
          && !usedFens.has(stableFenKey(position.fen_before)),
      );
      const needed = 3 - alreadySelected.length;
      if (needed <= 0) break;
      const differentGameSecondary = distinctSecondary.filter(
        (position) => !position.source_game_id || !usedGames.has(position.source_game_id),
      );
      const secondaryPool = differentGameSecondary.length >= needed
        ? differentGameSecondary
        : distinctSecondary;
      const added = selectDistinctPositions({
        positions: secondaryPool,
        attempts,
        focusPosition: null,
        seed: input.seed,
        nowMs: input.nowMs,
        count: needed,
        scope: supplemental.anchorKey,
      }).sort((a, b) => a.difficulty - b.difficulty);
      if (added.length > 0) {
        supplementalGroups.push(supplemental);
        secondarySelection.push(...added);
      }
      if (primarySelection.length + secondarySelection.length >= 3) break;
    }
  }

  const selected = [...primarySelection, ...secondarySelection];
  if (selected.length === 0) return null;
  while (selected.length < 3) {
    selected.push({
      ...selected[selected.length - 1],
      novelty: "reused_in_session",
    });
  }
  const [reviewItem, guidedItem, soloItem] = selected;
  const review = reviewItem.position;
  const guided = guidedItem.position;
  const solo = soloItem.position;
  const distinctPositions = new Set([review, guided, solo].map(stablePositionId)).size;
  const groupByKey = new Map(groups.map((group) => [group.anchorKey, group]));
  const phaseAnchor = (position: T): PhaseAnchor => {
    const anchorKey = anchorKeyForPosition(position);
    return {
      anchorKey,
      anchorLabel: groupByKey.get(anchorKey)?.label ?? displayLabel(anchorKey),
    };
  };
  const supplementalAnchors = supplementalGroups.map((group) => ({
    anchorKey: group.anchorKey,
    anchorLabel: group.label,
  }));
  const secondaryAnchor = supplementalAnchors[0] ?? null;
  const corpusFallback: CorpusFallback | null = secondaryAnchor
    ? {
        code: "secondary_anchor",
        primaryPositionsAvailable: primaryAvailable.length,
        secondaryAnchorKey: secondaryAnchor.anchorKey,
        secondaryAnchorLabel: secondaryAnchor.anchorLabel,
      }
    : distinctPositions < 3
      ? {
          code: "position_reuse",
          primaryPositionsAvailable: primaryAvailable.length,
          secondaryAnchorKey: null,
          secondaryAnchorLabel: null,
        }
      : null;
  return {
    anchorKey: chosen.anchorKey,
    anchorLabel: chosen.label,
    review,
    guided,
    solo,
    distinctPositions,
    reusedPosition: distinctPositions < 3,
    phaseAnchors: {
      review: phaseAnchor(review),
      guided: phaseAnchor(guided),
      solo: phaseAnchor(solo),
    },
    phaseNovelty: {
      review: reviewItem.novelty,
      guided: guidedItem.novelty,
      solo: soloItem.novelty,
    },
    secondaryAnchor,
    supplementalAnchors,
    corpusFallback,
    difficultyProgression: focusedInChosen
      ? "focus_override"
      : evidenceFirst
        ? "evidence_first"
      : secondaryAnchor
        ? "secondary_fallback"
        : distinctPositions < 3
          ? "limited_corpus"
          : "ascending",
    whyToday: {
      code: chosenReason,
      anchorKey: chosen.anchorKey,
      anchorLabel: chosen.label,
      currentSupport: chosen.currentSupport,
      targetRelevant: chosen.targetRelevant,
      relativePriority: chosen.relativePriority > 0 ? chosen.relativePriority : null,
      nextReviewAt: chosen.mastery?.nextReviewAt ?? null,
      observedWrongAttempts: chosen.observedWrongAttempts,
      observedHintUses: chosen.observedHintUses,
    },
  };
}
