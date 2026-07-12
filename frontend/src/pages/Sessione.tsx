/** Daily adaptive coaching session. */

import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { downloadJson, quadernoPath } from "../auth/storage";
import { PRODUCT_NAME } from "../coaching";
import { tr } from "../i18n/lang";
import { reportClientError } from "../lib/telemetry";
import type { Aggregates, PositionExample } from "../pipeline/aggregate";
import { getCachedAggregates, setCachedAggregates } from "../pipeline/aggregatesCache";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import {
  anchorKeyForPosition,
  mergeRecentSessionAttempts,
  selectAdaptiveSession,
  stablePositionId,
  type AdaptiveSessionSelection,
  type RecentSessionAttempt,
  type SessionAnchorMastery,
  type SessionAnchorPriority,
} from "../session/adaptiveSelector";
import { NonnoSession, type SessionPhase } from "../session/NonnoSession";
import { loadPassiveReviewAttempts } from "../session/passiveReviewHistory";
import {
  restoreAdaptiveSelection,
  shouldBlockAggregateRefreshFailure,
} from "../session/selectionPersistence";
import {
  completeSession,
  buildSessionSelectionSeed,
  decideSessionInitialization,
  decideSessionEntry,
  loadSession,
  saveSession,
  SESSION_SCHEMA,
  sessionInitializationKey,
  startNewSession,
  todayUTC,
  upgradeSessionWithPositionSnapshots,
  type PlayResult,
  type SessionState,
  type StepKey,
} from "../session/store";
import { getCard } from "../srs";
import {
  loadAnchorMastery,
  loadRecentTrainingAttempts,
} from "../trainingProgress";

type Selection = AdaptiveSessionSelection<PositionExample>;

function caduteOf(aggregates: Aggregates | null): PositionExample[] {
  return aggregates?.cadute ?? aggregates?.examples ?? [];
}

function priorityInputs(aggregates: Aggregates): SessionAnchorPriority[] {
  return (aggregates.anchors ?? []).map((anchor) => ({
    anchorKey: anchorKeyForPosition({
      error_type: anchor.type,
      fen_before: "",
      ply: 0,
    }),
    label: anchor.label_it,
    relativePriority: anchor.relative_priority,
    weightedScore: anchor.weighted_score,
  }));
}

function localRecentAttempts(positions: readonly PositionExample[]): RecentSessionAttempt[] {
  const srsAttempts = positions.flatMap((position) => {
    const card = getCard(stablePositionId(position));
    if (!card || card.lastSeen <= 0) return [];
    return [{
      anchorKey: anchorKeyForPosition(position),
      positionId: stablePositionId(position),
      sourceGameId: position.source_game_id,
      fenBefore: position.fen_before,
      verdict: card.lastVerdict,
      correct: card.lastVerdict == null ? null : card.lastVerdict !== "wrong",
      usedHint: false,
      attempts: 1,
      nextDueAt: new Date(card.nextDue).toISOString(),
      createdAt: new Date(card.lastSeen).toISOString(),
    }];
  });
  return [...srsAttempts, ...loadPassiveReviewAttempts()];
}

function contextString(context: unknown, key: string): string | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const value = (context as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function phaseFromStep(step: StepKey | undefined): SessionPhase {
  if (step === "warmup_guidato") return "aiuto";
  if (step === "drill") return "da-solo";
  if (step === "play") return "partita";
  if (step === "outro" || step === "recap") return "saluto";
  return "guardo";
}

function stepFromPhase(phase: SessionPhase): StepKey {
  if (phase === "aiuto") return "warmup_guidato";
  if (phase === "da-solo") return "drill";
  if (phase === "partita") return "play";
  if (phase === "saluto") return "outro";
  return "tema";
}

function initialSelectionFromCache(input: {
  aggregates: Aggregates | null;
  focusKey?: string;
  stored: SessionState | null;
  seed: string;
  allowRestore: boolean;
}): Selection | null {
  const positions = caduteOf(input.aggregates);
  if (input.allowRestore) {
    const restored = restoreAdaptiveSelection(positions, input.stored);
    if (restored) return restored;
  }
  if (!input.aggregates) return null;
  if (!input.focusKey || positions.length === 0) return null;
  return selectAdaptiveSession({
    positions,
    priorities: priorityInputs(input.aggregates),
    recentAttempts: localRecentAttempts(positions),
    focusKey: input.focusKey,
    seed: input.seed,
    nowMs: Date.now(),
  });
}

export function Sessione() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { dataVersion } = useOnboardingRun();
  const locationState = location.state as {
    focusKey?: string;
    viaMorph?: boolean;
    startAnother?: boolean;
  } | null;
  const focusKey = locationState?.focusKey;
  const viaMorph = locationState?.viaMorph === true;
  const [storedAtEntry] = useState<SessionState | null>(() => loadSession());
  const [recoveryNonce, setRecoveryNonce] = useState<string | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const explicitStartRequested = Boolean(
    focusKey || locationState?.startAnother === true || recoveryNonce,
  );
  const entryDecision = decideSessionEntry(
    storedAtEntry,
    todayUTC(),
    explicitStartRequested,
  );
  const focusMatchesStored = Boolean(
    focusKey
    && storedAtEntry
    && (
      storedAtEntry.temaPositionId === focusKey
      || storedAtEntry.warmupPositionId === focusKey
      || storedAtEntry.drillPositionId === focusKey
      || storedAtEntry.anchorKey === focusKey
    ),
  );
  const allowRestore = Boolean(
    storedAtEntry
    && storedAtEntry.date === todayUTC()
    && (
      storedAtEntry.finishedAt
        ? !explicitStartRequested
        : !explicitStartRequested || focusMatchesStored
    ),
  );
  const blockAutomaticStart = entryDecision === "completed";
  const selectionSeed = buildSessionSelectionSeed({
    userId: user?.id ?? "anonymous",
    date: todayUTC(),
    explicitStartRequested,
    focusKey,
    navigationKey: recoveryNonce ?? location.key,
  });

  const cachedAtMount = user ? getCachedAggregates(user.id, dataVersion) : null;
  const restoredAtMount = initialSelectionFromCache({
    aggregates: cachedAtMount,
    focusKey,
    stored: storedAtEntry,
    seed: selectionSeed,
    allowRestore,
  });

  const [aggregates, setAggregates] = useState<Aggregates | null>(cachedAtMount);
  const [selection, setSelection] = useState<Selection | null>(restoredAtMount);
  const [activeSession, setActiveSession] = useState<SessionState | null>(
    restoredAtMount ? storedAtEntry : null,
  );
  const [loadingData, setLoadingData] = useState(
    cachedAtMount == null && restoredAtMount == null,
  );
  const [selecting, setSelecting] = useState(
    restoredAtMount == null && caduteOf(cachedAtMount).length > 0,
  );
  const [selectionResolved, setSelectionResolved] = useState(
    blockAutomaticStart
      || restoredAtMount != null
      || (cachedAtMount != null && caduteOf(cachedAtMount).length === 0),
  );
  const [error, setError] = useState<string | null>(null);
  const initializedSelectionRef = useRef<string | null>(null);
  const selectionAvailableRef = useRef(selection != null);
  selectionAvailableRef.current = selection != null;

  useEffect(() => {
    if (!user || !profile) return;
    const cached = getCachedAggregates(user.id, dataVersion);
    if (cached) {
      setAggregates(cached);
      setLoadingData(false);
      return;
    }

    let cancelled = false;
    setLoadingData(true);
    void (async () => {
      try {
        const downloaded = await downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json"));
        if (cancelled) return;
        if (downloaded) setCachedAggregates(user.id, dataVersion, downloaded);
        setAggregates(downloaded);
        if (!downloaded) setSelectionResolved(true);
      } catch (cause) {
        if (!cancelled) {
          if (shouldBlockAggregateRefreshFailure(selectionAvailableRef.current)) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } else {
            void reportClientError(cause, {
              component: "Sessione.aggregateRefresh",
              context: { operation: "download_aggregates_with_frozen_session" },
            });
          }
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dataVersion, profile, user]);

  useEffect(() => {
    if (!aggregates || selection || !user) return;
    const positions = caduteOf(aggregates);
    if (allowRestore) {
      const restored = restoreAdaptiveSelection(positions, loadSession());
      if (restored) {
        setSelection(restored);
        setActiveSession(loadSession());
        setSelectionResolved(true);
        setSelecting(false);
        return;
      }
    }
    if (blockAutomaticStart || positions.length === 0) {
      setSelectionResolved(true);
      setSelecting(false);
      return;
    }

    // A focused position determines the anchor by definition. Avoid delaying
    // the Tavolo -> board morph for network data that cannot change that choice.
    if (focusKey) {
      setSelection(selectAdaptiveSession({
        positions,
        priorities: priorityInputs(aggregates),
        recentAttempts: localRecentAttempts(positions),
        focusKey,
        seed: selectionSeed,
        nowMs: Date.now(),
      }));
      setSelectionResolved(true);
      setSelecting(false);
      return;
    }

    let cancelled = false;
    setSelecting(true);
    void (async () => {
      const [masteryResult, attemptsResult] = await Promise.allSettled([
        loadAnchorMastery(),
        loadRecentTrainingAttempts(100),
      ]);
      if (cancelled) return;

      let mastery: SessionAnchorMastery[] = [];
      if (masteryResult.status === "fulfilled") {
        mastery = masteryResult.value.map((row) => ({
          anchorKey: row.anchor_key,
          status: row.status,
          masteryScore: row.mastery_score,
          nextReviewAt: row.next_review_at,
        }));
      } else {
        void reportClientError(masteryResult.reason, {
          component: "Sessione.adaptiveSelection",
          context: { operation: "load_anchor_mastery" },
        });
      }

      const localAttempts = localRecentAttempts(positions);
      let recentAttempts: RecentSessionAttempt[] = localAttempts;
      if (attemptsResult.status === "fulfilled") {
        const cloudAttempts: RecentSessionAttempt[] = attemptsResult.value.map((row) => ({
          anchorKey: row.anchor_key,
          positionId: row.position_id,
          sourceGameId: row.source_game_id,
          fenBefore: contextString(row.context, "fen_before"),
          mode: row.mode,
          verdict: row.verdict,
          correct: row.correct,
          usedHint: row.used_hint,
          attempts: row.attempt_number,
          createdAt: row.created_at,
        }));
        recentAttempts = mergeRecentSessionAttempts(localAttempts, cloudAttempts);
      } else {
        void reportClientError(attemptsResult.reason, {
          component: "Sessione.adaptiveSelection",
          context: { operation: "load_recent_training_attempts" },
        });
      }

      setSelection(selectAdaptiveSession({
        positions,
        priorities: priorityInputs(aggregates),
        mastery,
        recentAttempts,
        seed: selectionSeed,
        nowMs: Date.now(),
      }));
      setSelectionResolved(true);
      setSelecting(false);
    })();
    return () => { cancelled = true; };
  }, [aggregates, allowRestore, blockAutomaticStart, focusKey, selection, selectionSeed, user]);

  useEffect(() => {
    if (!selection) return;
    const identity = {
      selectionSeed,
      temaPositionId: stablePositionId(selection.review),
      warmupPositionId: stablePositionId(selection.guided),
      drillPositionId: stablePositionId(selection.solo),
      anchorKey: selection.anchorKey,
    };
    const initializationKey = sessionInitializationKey(identity);
    const existing = loadSession();
    const decision = decideSessionInitialization({
      initializedKey: initializedSelectionRef.current,
      currentSession: existing,
      date: todayUTC(),
      identity,
      explicitStartRequested,
      allowRestore,
    });
    initializedSelectionRef.current = initializationKey;
    if (decision === "keep") {
      if (existing) {
        const kept = existing.schema === SESSION_SCHEMA && existing.positionSnapshots
          ? existing
          : upgradeSessionWithPositionSnapshots(existing, {
              review: selection.review,
              guided: selection.guided,
              solo: selection.solo,
            });
        if (kept !== existing) saveSession(kept);
        setActiveSession(kept);
      }
      return;
    }
    if (decision === "block") {
      setRecoveryBlocked(true);
      setError(tr(
        "La sessione salvata non coincide piu' con le posizioni disponibili. Non l'ho azzerata: torna al Tavolo e scegli se iniziarne una nuova.",
        "The saved session no longer matches the available positions. I did not reset it: return to the Table and explicitly choose whether to start a new one.",
      ));
      return;
    }
    const next = startNewSession({
      drillIds: [stablePositionId(selection.guided), stablePositionId(selection.solo)],
      bivioIds: [],
      playFen: selection.review.fen_before,
      playMyColor: selection.review.color,
      temaPositionId: stablePositionId(selection.review),
      warmupPositionId: stablePositionId(selection.guided),
      drillPositionId: stablePositionId(selection.solo),
      anchorKey: selection.anchorKey,
      anchorLabel: selection.anchorLabel,
      whyTodayCode: selection.whyToday.code,
      whyCurrentSupport: selection.whyToday.currentSupport,
      whyTargetRelevant: selection.whyToday.targetRelevant,
      whyRelativePriority: selection.whyToday.relativePriority,
      whyNextReviewAt: selection.whyToday.nextReviewAt,
      whyObservedWrongAttempts: selection.whyToday.observedWrongAttempts,
      whyObservedHintUses: selection.whyToday.observedHintUses,
      distinctPositions: selection.distinctPositions,
      selectionSeed,
      phaseAnchorKeys: {
        review: selection.phaseAnchors.review.anchorKey,
        guided: selection.phaseAnchors.guided.anchorKey,
        solo: selection.phaseAnchors.solo.anchorKey,
      },
      phaseAnchorLabels: {
        review: selection.phaseAnchors.review.anchorLabel,
        guided: selection.phaseAnchors.guided.anchorLabel,
        solo: selection.phaseAnchors.solo.anchorLabel,
      },
      phaseNovelty: selection.phaseNovelty,
      supplementalAnchorKeys: selection.supplementalAnchors.map((anchor) => anchor.anchorKey),
      supplementalAnchorLabels: selection.supplementalAnchors.map((anchor) => anchor.anchorLabel),
      corpusFallbackCode: selection.corpusFallback?.code ?? null,
      corpusPrimaryPositionsAvailable:
        selection.corpusFallback?.primaryPositionsAvailable ?? selection.distinctPositions,
      difficultyProgression: selection.difficultyProgression,
      positionSnapshots: {
        review: selection.review,
        guided: selection.guided,
        solo: selection.solo,
      },
    });
    setActiveSession(next);
    if (recoveryNonce) {
      setRecoveryBlocked(false);
      setError(null);
    }
  }, [allowRestore, explicitStartRequested, recoveryNonce, selection, selectionSeed]);

  function persistPhase(phase: SessionPhase): void {
    const current = activeSession ?? loadSession();
    if (!current || current.date !== todayUTC()) return;
    const next = { ...current, step: stepFromPhase(phase) };
    saveSession(next);
    setActiveSession(next);
  }

  function persistCompletion(result: PlayResult): void {
    const current = activeSession ?? loadSession();
    if (!current || current.date !== todayUTC()) return;
    const completed = completeSession({ ...current, play: result }).session;
    setActiveSession(completed);
  }

  function confirmRecoveryStart(): void {
    const confirmed = window.confirm(tr(
      "La nuova sessione sostituira' quella salvata, che non e' piu' ricostruibile. Vuoi continuare?",
      "The new session will replace the saved one, which can no longer be reconstructed. Continue?",
    ));
    if (!confirmed) return;
    setRecoveryBlocked(false);
    setRecoveryNonce(`recovery-${Date.now().toString(36)}`);
  }

  if ((loadingData && !selection) || selecting || (!selectionResolved && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
        <div className="text-center">
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">{PRODUCT_NAME}</div>
          <div className="text-sm mt-2 text-[color:var(--color-text-soft)]">
            {tr("Scelgo cosa rivedere oggi…", "Choosing today's review.")}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--color-bg)" }}>
        <div className="surface surface-padded max-w-xl text-center">
          <div className="label-eyebrow text-rose-300 mb-2">{tr("Errore", "Error")}</div>
          <p className="text-[color:var(--color-text-soft)]">{error}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link to="/tavolo" className="btn btn-ghost inline-block">
              {tr("Torna al Tavolo", "Back to the Table")}
            </Link>
            {recoveryBlocked && (
              <button type="button" className="btn btn-primary" onClick={confirmRecoveryStart}>
                {tr("Inizia una nuova sessione", "Start a new session")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (blockAutomaticStart && !selection) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--color-bg)" }}>
        <div className="surface surface-padded max-w-xl text-center">
          <div className="label-eyebrow text-[color:var(--color-brand-soft)] mb-2">
            {tr("Sessione di oggi completata", "Today's session is complete")}
          </div>
          <p className="text-[color:var(--color-text-soft)]">
            {tr(
              "Non ne avvio un'altra uguale da solo. Se vuoi continuare, scegli esplicitamente una posizione diversa dal Tavolo.",
              "I will not start the same session again automatically. To continue, explicitly choose a different position from the Table.",
            )}
          </p>
          <Link to="/tavolo" className="btn btn-primary mt-4 inline-block">
            {tr("Scegli dal Tavolo", "Choose from the Table")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <NonnoSession
      selection={selection}
      sessionIdentity={activeSession?.selectionSeed ?? selectionSeed}
      targetRating={profile?.goal_rating ?? 1600}
      timeClass={profile?.goal_time_class ?? "rapid"}
      initialPhase={phaseFromStep(activeSession?.step)}
      onPhaseChange={persistPhase}
      onCompleted={persistCompletion}
      onClose={() => navigate("/tavolo")}
      viaMorph={viaMorph}
    />
  );
}
