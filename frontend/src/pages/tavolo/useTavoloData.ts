/**
 * useTavoloData — data layer extracted from TavoloHome.
 *
 * Loads all remote data (player_model_lite, aggregates, coach_brief, history),
 * computes all derived values, and wires up action handlers. TavoloHome becomes
 * a pure consumer of this hook.
 *
 * Rules:
 *   - Same effects, same deps, same cache handoff as TavoloHome had inline.
 *   - Zero behaviour changes. Only the code location moves.
 *   - Hook order is identical to TavoloHome's original order (critical for React).
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useOnboardingRun } from "../../pipeline/OnboardingRunContext";
import { useTavoloActionsRef } from "../../context/TavoloActionsContext";
import { downloadJson, quadernoPath } from "../../auth/storage";
import { runRefresh, runFullReanalyze } from "../../pipeline/orchestrator";
import type { Aggregates } from "../../pipeline/aggregate";
import type { PlayerModelLite } from "../../pipeline/playerModelLite";
import { goalProgress, anchorTrendsFromHistory, materialForGap } from "../../pipeline/history";
import { setCachedAggregates } from "../../pipeline/aggregatesCache";
import type { TimeClass } from "../../auth/db.types";
import type { HistorySnapshot, HistoryFile, AnchorTrail, GoalProgress, Goal } from "../../types";
import { readEntries } from "../../session/journal";

// ── djb2 hash — same as TavoloHome ───────────────────────────────────────────

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return String(h);
}

// ── Chess.com stats shape ─────────────────────────────────────────────────────

interface ChessComStats {
  chess_rapid?: { last?: { rating?: number } };
  chess_blitz?: { last?: { rating?: number } };
  chess_bullet?: { last?: { rating?: number } };
  chess_daily?: { last?: { rating?: number } };
}

function ratingFromStats(stats: ChessComStats, tc: TimeClass): number | null {
  switch (tc) {
    case "rapid":  return stats.chess_rapid?.last?.rating ?? null;
    case "blitz":  return stats.chess_blitz?.last?.rating ?? null;
    case "bullet": return stats.chess_bullet?.last?.rating ?? null;
    case "daily":  return stats.chess_daily?.last?.rating ?? null;
    default:       return null;
  }
}

// ── Live ELO hook ─────────────────────────────────────────────────────────────

function useLiveElo(
  chessComUsername: string | null | undefined,
  goalTimeClass: TimeClass | null | undefined,
): number | null {
  const [liveRating, setLiveRating] = useState<number | null>(null);

  useEffect(() => {
    if (!chessComUsername || !goalTimeClass) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `https://api.chess.com/pub/player/${encodeURIComponent(chessComUsername)}/stats`,
        );
        if (!r.ok) return;
        const stats = (await r.json()) as ChessComStats;
        const rating = ratingFromStats(stats, goalTimeClass);
        if (!cancelled && rating != null) setLiveRating(rating);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[useTavoloData] Chess.com live ELO fetch failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [chessComUsername, goalTimeClass]);

  return liveRating;
}

// ── Handicap story ────────────────────────────────────────────────────────────

function buildHandicapLine(snapshots: HistorySnapshot[]): string | null {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const firstMw = first.maia_weighted;
  const lastMw = last.maia_weighted;
  if (firstMw.mine_pct == null || firstMw.target_pct == null) return null;
  if (lastMw.mine_pct == null || lastMw.target_pct == null) return null;

  const firstGap = firstMw.target_pct - firstMw.mine_pct;
  const initialMaterial = materialForGap(firstGap);
  if (!initialMaterial) return null;

  const lastGap = lastMw.target_pct - lastMw.mine_pct;
  const currentMaterial = materialForGap(lastGap);

  const initialStep = initialMaterial.step;
  const currentStep = currentMaterial?.step ?? 0;
  if (currentStep >= initialStep) return null;

  if (currentMaterial != null) {
    return `Quando ci siamo seduti la prima volta ti avrei dato ${initialMaterial.label} di vantaggio. Oggi ti darei ${currentMaterial.label}.`;
  }
  return `Quando ci siamo seduti la prima volta ti avrei dato ${initialMaterial.label} di vantaggio. Oggi giochiamo quasi alla pari.`;
}

// ── Memoria visibile ──────────────────────────────────────────────────────────

function buildMemoria(): string | null {
  const entries = readEntries();
  if (entries.length === 0) return null;

  const lastSession = entries.find((e) => e.kind === "session_done");
  const ref = lastSession ?? entries[0];

  const today = new Date();
  const todayUtcMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const parts = ref.date.split("-").map((n) => parseInt(n, 10));
  let whenClause = "L'altra volta";
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    const refUtcMid = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const days = Math.round((todayUtcMid - refUtcMid) / 86400000);
    if (days === 1) whenClause = "Ieri";
    else if (days >= 2 && days <= 6) whenClause = `${days} giorni fa`;
    else if (days > 6) whenClause = "L'ultima volta";
  }

  if (lastSession != null) {
    const motif = typeof lastSession.meta?.dominant_motif === "string"
      ? lastSession.meta.dominant_motif
      : null;
    if (motif) {
      return `${whenClause} abbiamo lavorato su "${motif}". Riprendiamo da li'.`;
    }
    return `${whenClause} ci siamo seduti insieme. Riprendiamo da li'.`;
  }
  return `${whenClause} sei passato dal Tavolo. Bene, riprendiamo.`;
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface TavoloData {
  // Raw loaded data
  pmLite: PlayerModelLite | null;
  aggregates: Aggregates | null;
  historySnapshots: HistorySnapshot[] | null;

  // LLM voice
  llmVoice: string | null | undefined;
  llmGeneratedAt: string | undefined;

  // Loading state
  loading: boolean;
  error: string | null;

  // Action states
  refreshing: boolean;
  reanalyzing: boolean;

  // Derived: memoria visibile (reads localStorage synchronously)
  memoriaVisibile: string | null;

  // Derived: live ELO + live goal
  liveElo: number | null;
  /** Goal struct with current_rating patched to liveElo if available. */
  liveGoal: Goal | undefined;

  // Derived: ratings
  currentRating: number | null;
  startRating: number;
  targetRating: number;
  deadline: string;

  // Derived: goal progress
  onTrack: boolean;
  goalProgressData: GoalProgress | null;

  // Derived: handicap story
  handicapLine: string | null;

  // Derived: anchor trails for micro-sparklines
  anchorTrails: AnchorTrail[];

  // Letter freshness
  letterIdentity: string | null;
  letterSeenBefore: boolean;
  letterOpenedThisVisit: boolean;

  // Incremental counter that forces data reload after background pipeline
  dataVersion: number;

  // Actions
  markLetterSeen: () => void;
  runRefreshHandler: () => Promise<void>;
  runFullReanalyzeHandler: () => Promise<void>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTavoloData(): TavoloData {
  const { user, profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const { dataVersion } = useOnboardingRun();
  const tavoloActionsRef = useTavoloActionsRef();

  const [pmLite, setPmLite] = useState<PlayerModelLite | null>(null);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [llmVoice, setLlmVoice] = useState<string | null | undefined>(undefined);
  const [llmGeneratedAt, setLlmGeneratedAt] = useState<string | undefined>(undefined);
  const [letterSeenBefore, setLetterSeenBefore] = useState(false);
  const [letterOpenedThisVisit, setLetterOpenedThisVisit] = useState(false);
  const [historySnapshots, setHistorySnapshots] = useState<HistorySnapshot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const briefPromise = downloadJson<{ voice_message?: string; generated_at?: string }>(
          quadernoPath(user.id, "coach_brief.json"),
        ).catch(() => null);
        const historyPromise = downloadJson<{ snapshots?: HistorySnapshot[] }>(
          quadernoPath(user.id, "history.json"),
        ).catch(() => null);

        const [pm, agg, brief, history] = await Promise.all([
          downloadJson<PlayerModelLite>(quadernoPath(user.id, "player_model_lite.json")),
          downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json")),
          briefPromise,
          historyPromise,
        ]);
        if (cancelled) return;
        setPmLite(pm);
        setAggregates(agg);
        if (agg) setCachedAggregates(user.id, dataVersion, agg);
        const voice = brief?.voice_message ?? null;
        setLlmVoice(voice);
        setLlmGeneratedAt(brief?.generated_at ?? undefined);
        if (voice && voice.trim().length > 0) {
          const identity = brief?.generated_at ?? djb2(voice.trim());
          const seen = localStorage.getItem("nonno_letter_seen");
          setLetterSeenBefore(seen === identity);
        }
        setHistorySnapshots(history?.snapshots ?? null);
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // dataVersion: increments when background pipeline finishes, forces data reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dataVersion]);

  async function runRefreshHandler() {
    if (!profile) return;
    setRefreshing(true);
    try {
      await runRefresh(profile);
      await refreshProfile();
      nav("/onboarding/waiting", { replace: true });
    } finally {
      setRefreshing(false);
    }
  }

  async function runFullReanalyzeHandler() {
    if (!profile) return;
    setReanalyzing(true);
    try {
      await runFullReanalyze(profile);
      await refreshProfile();
      nav("/onboarding/waiting", { replace: true });
    } finally {
      setReanalyzing(false);
    }
  }

  // Register the action callbacks in the shared context so AppShell sidebar can call them.
  // We write to the mutable ref every render (safe, avoids stale closures).
  tavoloActionsRef.current = {
    handleRefresh: () => void runRefreshHandler(),
    handleFullReanalyze: () => void runFullReanalyzeHandler(),
  };
  // Clear on unmount so the sidebar never holds stale closures from a dead mount.
  useEffect(() => {
    return () => {
      tavoloActionsRef.current = null;
    };
  }, [tavoloActionsRef]);

  // Live ELO from Chess.com (display-only, falls back to stored value).
  const liveElo = useLiveElo(profile?.chess_com_username, profile?.goal_time_class);

  // ── Derived values ────────────────────────────────────────────────────────

  const goal = pmLite?.identity?.goal;
  const storedRating = goal?.current_rating ?? pmLite?.current_rating ?? null;
  const currentRating = liveElo ?? storedRating;
  const liveGoal = goal ? { ...goal, current_rating: currentRating } : undefined;
  const targetRating = profile?.goal_rating ?? goal?.target ?? 0;
  const startRating = goal?.start_rating ?? currentRating ?? 0;
  const onTrack = goal?.on_track ?? false;
  const deadline = goal?.deadline ?? "";

  const goalProgressData = liveGoal ? goalProgress(liveGoal) : null;

  const handicapLine = historySnapshots ? buildHandicapLine(historySnapshots) : null;

  const anchorTrails: AnchorTrail[] = historySnapshots && historySnapshots.length >= 2
    ? anchorTrendsFromHistory({ schema_version: 1, snapshots: historySnapshots } as HistoryFile)
    : [];

  // Reads localStorage synchronously — stable across renders.
  const memoriaVisibile = buildMemoria();

  const hasVoice = llmVoice != null && llmVoice.trim().length > 0;
  const letterIdentity = hasVoice
    ? (llmGeneratedAt ?? djb2(llmVoice!.trim()))
    : null;

  function markLetterSeen() {
    if (letterIdentity) {
      localStorage.setItem("nonno_letter_seen", letterIdentity);
      setLetterOpenedThisVisit(true);
    }
  }

  return {
    pmLite,
    aggregates,
    historySnapshots,
    llmVoice,
    llmGeneratedAt,
    loading,
    error,
    refreshing,
    reanalyzing,
    memoriaVisibile,
    liveElo,
    liveGoal,
    currentRating,
    startRating,
    targetRating,
    deadline,
    onTrack,
    goalProgressData,
    handicapLine,
    anchorTrails,
    letterIdentity,
    letterSeenBefore,
    letterOpenedThisVisit,
    dataVersion,
    markLetterSeen,
    runRefreshHandler,
    runFullReanalyzeHandler,
  };
}
