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
import { downloadJson, quadernoPath } from "../../auth/storage";
import { runRefresh, runFullReanalyze } from "../../pipeline/orchestrator";
import type { Aggregates } from "../../pipeline/aggregate";
import type { PlayerModelLite } from "../../pipeline/playerModelLite";
import { goalProgress, anchorTrendsFromHistory } from "../../pipeline/history";
import { setCachedAggregates } from "../../pipeline/aggregatesCache";
import type { TimeClass } from "../../auth/db.types";
import type { HistorySnapshot, HistoryFile, AnchorTrail, GoalProgress, Goal } from "../../types";
import { readEntries } from "../../session/journal";
import { tr } from "../../i18n/lang";
import { scopedStorage } from "../../auth/userStorage";

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

// ── Memoria visibile ──────────────────────────────────────────────────────────

function buildMemoria(): string | null {
  const entries = readEntries();
  if (entries.length === 0) return null;

  const lastSession = entries.find((e) => e.kind === "session_done");
  const ref = lastSession ?? entries[0];

  const today = new Date();
  const todayUtcMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const parts = ref.date.split("-").map((n) => parseInt(n, 10));
  let whenClause = tr("L'altra volta", "Last time");
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    const refUtcMid = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const days = Math.round((todayUtcMid - refUtcMid) / 86400000);
    if (days === 1) whenClause = tr("Ieri", "Yesterday");
    else if (days >= 2 && days <= 6) whenClause = tr(`${days} giorni fa`, `${days} days ago`);
    else if (days > 6) whenClause = tr("L'ultima volta", "Last time");
  }

  if (lastSession != null) {
    const motif = typeof lastSession.meta?.dominant_motif === "string"
      ? lastSession.meta.dominant_motif
      : null;
    if (motif) {
      return tr(
        `${whenClause} abbiamo lavorato su "${motif}". Riprendiamo da li'.`,
        `${whenClause} we worked on "${motif}". Let's pick it up from there.`,
      );
    }
    return tr(
      `${whenClause} ci siamo seduti insieme. Riprendiamo da li'.`,
      `${whenClause} we sat down together. Let's pick it up from there.`,
    );
  }
  return tr(
    `${whenClause} sei passato dal Tavolo. Bene, riprendiamo.`,
    `${whenClause} you stopped by. Good. Let's get started.`,
  );
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
  refreshError: string | null;
  refreshNotice: string | null;

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
  /** Ritmo mostrabile solo con >=14 giorni e >=10 partite dopo l'onboarding. */
  goalTrendReady: boolean;

  // Derived: anchor trails for micro-sparklines
  anchorTrails: AnchorTrail[];

  // Letter freshness
  letterIdentity: string | null;
  letterSeenBefore: boolean;

  // Incremental counter that forces data reload after background pipeline
  dataVersion: number;

  // True while a dataVersion-triggered reload is in flight (the background just
  // finished and we are re-downloading aggregates). Lets the Tavolo hold the
  // "still looking" state instead of flashing "few games" during the reload gap.
  reloading: boolean;

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

  const [pmLite, setPmLite] = useState<PlayerModelLite | null>(null);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [llmVoice, setLlmVoice] = useState<string | null | undefined>(undefined);
  const [llmGeneratedAt, setLlmGeneratedAt] = useState<string | undefined>(undefined);
  const [letterSeenBefore, setLetterSeenBefore] = useState(false);
  const [historySnapshots, setHistorySnapshots] = useState<HistorySnapshot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which dataVersion the currently-loaded data matches. When it lags behind
  // dataVersion a reload is in flight (computed synchronously into `reloading`).
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const [refreshing, setRefreshing] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

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
          const seen = scopedStorage.getItem("nonno_letter_seen");
          setLetterSeenBefore(seen === identity);
        }
        setHistorySnapshots(history?.snapshots ?? null);
      } catch {
        if (!cancelled) {
          // Do not surface provider/storage internals as product copy.
          // eslint-disable-next-line no-console
          console.warn("[tavolo] data_load_failed");
          setError(tr(
            "Non riesco a leggere i dati del Tavolo. Controlla la connessione e riprova.",
            "I cannot load the Table data. Check your connection and try again.",
          ));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadedVersion(dataVersion);
        }
      }
    })();
    return () => { cancelled = true; };
    // dataVersion: increments when background pipeline finishes, forces data reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dataVersion]);

  async function runRefreshHandler() {
    if (!profile) return;
    setRefreshError(null);
    setRefreshNotice(null);
    setRefreshing(true);
    try {
      const started = await runRefresh(profile);
      if (!started) {
        const timeClass = profile.goal_time_class;
        setRefreshNotice(tr(
          `Non ci sono nuove partite ${timeClass}. Il Tavolo è già aggiornato.`,
          `There are no new ${timeClass} games. The Table is already up to date.`,
        ));
        return;
      }
      await refreshProfile();
      nav("/onboarding/waiting", { replace: true });
    } catch {
      setRefreshError(tr(
        "L'aggiornamento si è interrotto. I dati già pronti restano disponibili: puoi riprovare.",
        "The update stopped. Your existing data remains available; you can try again.",
      ));
    } finally {
      setRefreshing(false);
    }
  }

  async function runFullReanalyzeHandler() {
    if (!profile) return;
    setRefreshError(null);
    setRefreshNotice(null);
    setReanalyzing(true);
    try {
      await runFullReanalyze(profile);
      await refreshProfile();
      nav("/onboarding/waiting", { replace: true });
    } catch {
      setRefreshError(tr(
        "La rianalisi si è interrotta. I dati precedenti restano disponibili.",
        "Reanalysis stopped. Your previous data remains available.",
      ));
    } finally {
      setReanalyzing(false);
    }
  }

  // Live ELO from Chess.com (display-only, falls back to stored value).
  const liveElo = useLiveElo(profile?.chess_com_username, profile?.goal_time_class);

  // ── Derived values ────────────────────────────────────────────────────────

  const goal = pmLite?.identity?.goal;
  const storedRating = goal?.current_rating ?? pmLite?.current_rating ?? null;
  const currentRating = liveElo ?? storedRating;
  const targetRating = profile?.goal_rating ?? goal?.target ?? 0;
  const startRating = goal?.start_rating ?? currentRating ?? 0;
  // If Chess.com has a fresher rating, recompute every dependent field from
  // that same value. Never pair a live rating with stale pace/projection data.
  const liveGoal = goal ? (() => {
    const signedGain = currentRating != null && goal.start_rating != null
      ? currentRating - goal.start_rating
      : 0;
    const pointsNeeded = currentRating != null
      ? Math.max(0, goal.target - currentRating)
      : goal.target;
    const ratePerDay = currentRating != null && goal.start_rating != null && goal.days_since_start > 0
      ? signedGain / goal.days_since_start
      : null;
    const rateNeeded = goal.days_left > 0 ? pointsNeeded / goal.days_left : null;
    const projection = currentRating != null && ratePerDay != null
      ? Math.round(currentRating + ratePerDay * goal.days_left)
      : null;
    return {
      ...goal,
      current_rating: currentRating,
      points_gained_since_start: signedGain,
      points_needed: pointsNeeded,
      rate_per_day_so_far: ratePerDay,
      rate_per_day_needed: rateNeeded,
      projection_at_deadline: projection,
      on_track: projection != null && projection >= goal.target,
    };
  })() : undefined;
  const onTrack = liveGoal?.on_track ?? false;
  const deadline = goal?.deadline ?? "";

  const goalProgressData = liveGoal ? goalProgress(liveGoal) : null;
  const planStartedMs = pmLite?.identity.plan_started_at
    ? Date.parse(pmLite.identity.plan_started_at)
    : Number.NaN;
  const gamesAfterOnboarding = Number.isFinite(planStartedMs) && goal?.time_class
    // plan_started_at is date-only: start on the following UTC day so games
    // from before onboarding on that same date are never counted as post-plan.
    ? (pmLite?.rating_curve[goal.time_class] ?? [])
        .filter((point) => point.epoch >= planStartedMs + 86_400_000).length
    : 0;
  const goalTrendReady = (liveGoal?.days_since_start ?? 0) >= 14
    && gamesAfterOnboarding >= 10;

  const anchorTrails: AnchorTrail[] = historySnapshots && historySnapshots.length >= 2
    ? anchorTrendsFromHistory({ schema_version: 1, snapshots: historySnapshots } as HistoryFile)
    : [];

  // Reads user-scoped browser state synchronously — stable across renders.
  const memoriaVisibile = buildMemoria();

  const hasVoice = llmVoice != null && llmVoice.trim().length > 0;
  const letterIdentity = hasVoice
    ? (llmGeneratedAt ?? djb2(llmVoice!.trim()))
    : null;

  function markLetterSeen() {
    if (letterIdentity) {
      scopedStorage.setItem("nonno_letter_seen", letterIdentity);
    }
  }

  // Synchronous: true on the very render where dataVersion bumped, until the
  // reload settles loadedVersion back to it. No one-frame lag, so no flash.
  const reloading = loadedVersion !== dataVersion;

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
    refreshError,
    refreshNotice,
    memoriaVisibile,
    liveElo,
    liveGoal,
    currentRating,
    startRating,
    targetRating,
    deadline,
    onTrack,
    goalProgressData,
    goalTrendReady,
    anchorTrails,
    letterIdentity,
    letterSeenBefore,
    dataVersion,
    reloading,
    markLetterSeen,
    runRefreshHandler,
    runFullReanalyzeHandler,
  };
}
