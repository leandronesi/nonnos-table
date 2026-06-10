/**
 * History — temporal layer for Nonno's Table (§2.2-2.3 BUILD.md).
 *
 * Pure functions + isolated Storage I/O.
 * Reuses the same uploadJson/downloadJson/quadernoPath helpers as aggregate.ts.
 *
 * Functions:
 *   readHistory(userId)                  — load quaderno/history.json or empty stub
 *   appendSnapshot(userId, snap)         — dedup by week_iso (last wins), keep 52, write
 *   anchorTrendsFromHistory(history)     — series per anchor from snapshots
 *   computeMilestones(opts)              — deterministic Milestone[] (achieved + in-progress)
 *   goalProgress(goal)                   — GoalProgress from Goal struct
 */

import { downloadJson, uploadJson, quadernoPath } from "../auth/storage";
import type {
  HistoryFile,
  HistorySnapshot,
  Milestone,
  MilestoneType,
  GoalProgress,
  TransferMotifStat,
  AnchorTrail,
  AnchorTrailPoint,
} from "../types";
import type { Goal } from "../types";
import type { Aggregates } from "./aggregate";

// ── ISO week helper ──────────────────────────────────────────────────────────

/**
 * Returns the ISO week string for a given Date, e.g. "2026-W22".
 * ISO 8601: week 1 = the week containing the first Thursday of the year.
 */
export function toWeekIso(date: Date): string {
  // Algorithm: find Thursday of the current week, then determine the year and week.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Shift to nearest Thursday: ISO weeks start on Monday.
  d.setUTCDate(d.getUTCDate() + 4 - (day === 0 ? 7 : day));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ── Storage I/O ──────────────────────────────────────────────────────────────

const HISTORY_MAX_SNAPSHOTS = 52;

/**
 * Reads the history file for the user from Storage.
 * Returns { schema_version: 1, snapshots: [] } if the file does not exist.
 */
export async function readHistory(userId: string): Promise<HistoryFile> {
  const path = quadernoPath(userId, "history.json");
  const data = await downloadJson<HistoryFile>(path);
  if (data && data.schema_version === 1 && Array.isArray(data.snapshots)) {
    return data;
  }
  return { schema_version: 1, snapshots: [] };
}

/**
 * Appends (or replaces) a snapshot in the history file and writes it back.
 *
 * Dedup: if a snapshot with the same week_iso already exists, the new one
 * replaces it (last run in a week wins). Keeps at most HISTORY_MAX_SNAPSHOTS.
 */
export async function appendSnapshot(
  userId: string,
  snap: HistorySnapshot,
): Promise<void> {
  const history = await readHistory(userId);

  // Dedup: remove any existing snapshot with the same week_iso.
  const filtered = history.snapshots.filter((s) => s.week_iso !== snap.week_iso);
  filtered.push(snap);

  // Keep the most recent N snapshots (sort by captured_at desc, take first N).
  filtered.sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  const trimmed = filtered.slice(0, HISTORY_MAX_SNAPSHOTS);

  const updated: HistoryFile = { schema_version: 1, snapshots: trimmed };
  const path = quadernoPath(userId, "history.json");
  await uploadJson(path, updated);
}

// ── Derived computations (pure) ──────────────────────────────────────────────

/**
 * Returns an AnchorTrail[] for each anchor key that appears in >= 2 snapshots.
 *
 * The signal is FREQUENCY PER GAME (count / games_analyzed), not mine_pct
 * (which is static Maia "obviousness" and does not reflect learning progress).
 *
 * Rules:
 *   - Series with < 2 points are dropped entirely (no meaningful trend).
 *   - freq is null when games_analyzed == 0 (honest — never divide by zero).
 *   - direction uses a >= 20% relative threshold on first vs last freq, matching
 *     the anchor_improved milestone logic for internal consistency.
 *   - When either endpoint freq is null, direction = "stable".
 *
 * Points are ordered chronologically (oldest first).
 */
export function anchorTrendsFromHistory(history: HistoryFile): AnchorTrail[] {
  // Collect raw points per anchor key from snapshots in chronological order.
  const rawMap: Map<
    string,
    { label_it: string; points: AnchorTrailPoint[] }
  > = new Map();

  const sorted = [...history.snapshots].sort((a, b) =>
    a.captured_at.localeCompare(b.captured_at),
  );

  for (const snap of sorted) {
    const games = snap.games_analyzed;
    for (const a of snap.anchors) {
      if (!rawMap.has(a.key)) {
        rawMap.set(a.key, { label_it: a.label_it, points: [] });
      }
      const entry = rawMap.get(a.key)!;
      // Honest: label_it may evolve; keep most-recent label (last snap wins as
      // we iterate chronologically and overwrite).
      entry.label_it = a.label_it;
      const freq: number | null = games > 0 ? a.count / games : null;
      entry.points.push({
        captured_at: snap.captured_at,
        week_iso: snap.week_iso,
        freq,
        count: a.count,
        games,
      });
    }
  }

  const trails: AnchorTrail[] = [];

  for (const [key, { label_it, points }] of rawMap.entries()) {
    // Drop series with < 2 data points — no trend can be inferred.
    if (points.length < 2) continue;

    const first = points[0];
    const last = points[points.length - 1];

    // direction: >= 20% relative change in freq (same threshold as anchor_improved),
    // but ONLY for material anchors. An anchor seen ~once every 33-50 games (count
    // 1-2 per snapshot) is statistical noise: flagging it "in salita / tienila
    // d'occhio" just confuses. Require >= 3 occurrences in at least one endpoint.
    let direction: AnchorTrail["direction"] = "stable";
    const material = Math.max(first.count ?? 0, last.count ?? 0) >= 3;
    if (material && first.freq != null && last.freq != null && first.freq > 0) {
      const ratio = last.freq / first.freq;
      if (ratio <= 0.80) direction = "improving";    // ≥20% relative drop
      else if (ratio >= 1.20) direction = "worsening"; // ≥20% relative rise
    }

    // confidence: based on number of points and minimum count per point.
    const minCount = Math.min(...points.map((p) => p.count));
    let confidence: AnchorTrail["confidence"];
    if (points.length >= 4 && minCount >= 3) {
      confidence = "high";
    } else if (points.length >= 2 && minCount >= 2) {
      confidence = "medium";
    } else {
      confidence = "low";
    }

    trails.push({ key, label_it, points, direction, confidence });
  }

  // Sort by key for stable output (UI can re-sort by direction/confidence).
  trails.sort((a, b) => a.key.localeCompare(b.key));

  return trails;
}

// ── Milestones ───────────────────────────────────────────────────────────────

/**
 * Deterministic milestone computation (§1.3 BUILD.md).
 *
 * Types checked:
 *   rating_gain    +25 / +50 / +100 ELO from the first snapshot's current rating.
 *   gap_closed     % of ELO gap to target that has been closed.
 *   anchor_improved one anchor improved >= 10pp in mine_pct between first/last snapshot.
 *   anchor_domata   an anchor whose count dropped to 0 or fell out of top anchors.
 *   on_track        current projection >= target.
 *
 * drillLog is reserved for the "sessions" milestone type (not yet tracked — skipped).
 */
export function computeMilestones(opts: {
  history: HistoryFile;
  goal: Goal;
  aggregates: Aggregates;
  drillLog?: unknown;
}): Milestone[] {
  const { history, goal, aggregates: _aggregates } = opts;
  void _aggregates; // reserved for future milestone types that inspect aggregates directly
  const milestones: Milestone[] = [];

  // Need at least two snapshots for meaningful comparisons.
  const snaps = [...history.snapshots].sort((a, b) =>
    a.captured_at.localeCompare(b.captured_at),
  );
  const firstSnap = snaps[0] ?? null;
  const lastSnap  = snaps[snaps.length - 1] ?? null;

  const currentRating =
    goal.current_rating ?? lastSnap?.goal.current ?? null;
  const startRating =
    goal.start_rating ?? firstSnap?.goal.current ?? null;
  const targetRating = goal.target;

  // ── rating_gain milestones ─────────────────────────────────────────────────
  const RATING_GAIN_THRESHOLDS = [25, 50, 100] as const;
  const gained =
    currentRating != null && startRating != null
      ? currentRating - startRating
      : null;

  for (const threshold of RATING_GAIN_THRESHOLDS) {
    if (gained == null) continue;
    const achieved = gained >= threshold;
    milestones.push(makeMilestone({
      type: "rating_gain",
      threshold,
      achieved,
      evidence: gained,
      achieved_at: achieved && lastSnap ? lastSnap.captured_at : null,
      label_it: `+${threshold} punti di rating guadagnati`,
    }));
  }

  // ── gap_closed milestone ───────────────────────────────────────────────────
  if (startRating != null && currentRating != null && targetRating > startRating) {
    const originalGap = targetRating - startRating;
    const closedPct   = Math.min(1, Math.max(0, (currentRating - startRating) / originalGap));
    const THRESHOLDS_GAP = [0.25, 0.5, 0.75, 1.0] as const;
    for (const thr of THRESHOLDS_GAP) {
      const achieved = closedPct >= thr;
      milestones.push(makeMilestone({
        type: "gap_closed",
        threshold: thr,
        achieved,
        evidence: Math.round(closedPct * 100),
        achieved_at: achieved && lastSnap ? lastSnap.captured_at : null,
        label_it: `${Math.round(thr * 100)}% del gap verso il target chiuso`,
      }));
    }
  }

  // ── anchor_improved + anchor_domata (need >= 2 snapshots) ─────────────────
  if (firstSnap && lastSnap && firstSnap.week_iso !== lastSnap.week_iso) {
    const firstAnchorMap = new Map(firstSnap.anchors.map((a) => [a.key, a]));
    const lastAnchorMap  = new Map(lastSnap.anchors.map((a)  => [a.key, a]));

    // anchor_improved: the error-per-game FREQUENCY of this anchor fell
    // significantly between first and last snapshot.
    //
    // Honest signal: absolute count is unreliable (it grows with more games
    // analysed). Frequency = count / games_analyzed is the right denominator.
    // A drop of >= 20% relative to the first snapshot frequency is the threshold
    // (e.g. 0.50 errors/game → 0.38 errors/game = −24% → improved).
    // Minimum first-snapshot count of 3 to avoid noise on sparse data.
    const IMPROVED_RELATIVE_DROP = 0.20;  // 20% relative fall in frequency
    const IMPROVED_MIN_COUNT = 3;         // at least 3 errors in first snapshot
    for (const [key, last] of lastAnchorMap) {
      const first = firstAnchorMap.get(key);
      if (!first) continue;
      const firstGames = firstSnap.games_analyzed;
      const lastGames  = lastSnap.games_analyzed;
      if (firstGames <= 0 || lastGames <= 0) continue;
      if (first.count < IMPROVED_MIN_COUNT) continue;
      const firstFreq = first.count / firstGames;
      const lastFreq  = last.count  / lastGames;
      // Relative drop: (firstFreq - lastFreq) / firstFreq
      const relativeDrop = firstFreq > 0 ? (firstFreq - lastFreq) / firstFreq : 0;
      const achieved = relativeDrop >= IMPROVED_RELATIVE_DROP;
      void key; // suppress unused-var lint (key used implicitly through map iteration)
      // FIX A: evidence and threshold must share the same unit (fractions, 0..1).
      // Previously evidence was Math.round(relativeDrop*100) (integer pct) while
      // threshold was 0.20 (fraction), causing progress_pct = 10/0.20 = 50 → clamped
      // to 1 → 100% for a milestone that had NOT been reached yet. Both are now
      // fractions so progress_pct = relativeDrop/IMPROVED_RELATIVE_DROP is correct.
      milestones.push(makeMilestone({
        type: "anchor_improved",
        threshold: IMPROVED_RELATIVE_DROP,
        achieved,
        evidence: relativeDrop, // fraction (same unit as threshold)
        achieved_at: achieved ? lastSnap.captured_at : null,
        label_it: `"${last.label_it}" in miglioramento (${Math.round(Math.max(0, relativeDrop) * 100)}% meno frequente)`,
      }));
    }

    // anchor_domata: an anchor that was in top-3 at first but is gone or count=0 now.
    const firstTop3 = firstSnap.anchors.slice(0, 3);
    for (const a of firstTop3) {
      const last = lastAnchorMap.get(a.key);
      const domata = !last || last.count === 0;
      milestones.push(makeMilestone({
        type: "anchor_domata",
        threshold: 0,
        achieved: domata,
        evidence: last?.count ?? 0,
        achieved_at: domata ? lastSnap.captured_at : null,
        label_it: `"${a.label_it}" uscita dal tuo profilo`,
      }));
    }
  }

  // ── on_track milestone ─────────────────────────────────────────────────────
  const onTrack = goal.on_track;
  milestones.push(makeMilestone({
    type: "on_track",
    threshold: 1,
    achieved: onTrack,
    evidence: goal.projection_at_deadline ?? null,
    achieved_at: onTrack && lastSnap ? lastSnap.captured_at : null,
    label_it: "In carreggiata per raggiungere il target",
  }));

  // ── sessions — placeholder (drill log not yet tracked) ─────────────────────
  // skipped: no data source yet.

  // Remove on_track duplicates / keep most informative; return all for UI.
  return milestones;
}

/** Internal helper to build a Milestone object. */
function makeMilestone(opts: {
  type: MilestoneType;
  threshold: number;
  achieved: boolean;
  evidence: number | null;
  achieved_at: string | null;
  label_it: string;
}): Milestone {
  const progress_pct =
    !opts.achieved && opts.evidence != null && opts.threshold > 0
      ? Math.min(1, Math.max(0, opts.evidence / opts.threshold))
      : opts.achieved
      ? 1
      : null;
  return {
    type: opts.type,
    achieved: opts.achieved,
    achieved_at: opts.achieved ? opts.achieved_at : null,
    progress_pct,
    evidence: opts.evidence,
    label_it: opts.label_it,
    threshold: opts.threshold,
  };
}

// ── GoalProgress ─────────────────────────────────────────────────────────────

/**
 * Computes GoalProgress from a Goal struct (§2.3 BUILD.md).
 * All calculations are deterministic from Goal fields alone.
 */
export function goalProgress(goal: Goal): GoalProgress {
  const WEEKS_IN_DAY = 1 / 7;

  const weeks_left = goal.days_left > 0 ? goal.days_left * WEEKS_IN_DAY : 0;
  const points_needed = Math.max(0, goal.points_needed);

  const rate_needed_per_week =
    weeks_left > 0 ? points_needed / weeks_left : null;

  // Real rate from start: points_gained_since_start / weeks_since_start.
  const weeks_since_start =
    goal.days_since_start > 0 ? goal.days_since_start * WEEKS_IN_DAY : null;

  const rate_real_per_week =
    weeks_since_start != null && weeks_since_start > 0
      ? goal.points_gained_since_start / weeks_since_start
      : null;

  // Projection at deadline at current rate.
  const projection =
    rate_real_per_week != null && weeks_left > 0
      ? (goal.current_rating ?? 0) + rate_real_per_week * weeks_left
      : goal.projection_at_deadline ?? null;

  return {
    points_needed,
    weeks_left,
    rate_needed_per_week,
    rate_real_per_week,
    on_track: goal.on_track,
    projection,
  };
}

// ── materialForGap — shared piece-metaphor helper ─────────────────────────────

/**
 * Maps a gap in percentage points (target_pct - mine_pct from maia_weighted)
 * to a chess-piece metaphor. Returns null when the player is nearly at par.
 *
 * Exported so both TavoloHome and Viaggio can share the same scale.
 */
export function materialForGap(gapPp: number): { step: number; label: string } | null {
  if (gapPp >= 25) return { step: 5, label: "la regina" };
  if (gapPp >= 18) return { step: 4, label: "una torre" };
  if (gapPp >= 12) return { step: 3, label: "un alfiere" };
  if (gapPp >= 8)  return { step: 2, label: "due pedoni" };
  if (gapPp >= 4)  return { step: 1, label: "un pedone" };
  return null; // quasi alla pari
}

// ── Snapshot builder helper (used by orchestrator.ts) ────────────────────────

/**
 * Builds a compact HistorySnapshot from aggregates + goal.
 * run_kind defaults to "refresh" if not provided.
 */
export function buildSnapshot(
  aggregates: Aggregates,
  goal: Goal,
  run_kind: HistorySnapshot["run_kind"] = "refresh",
): HistorySnapshot {
  const now = new Date();

  // rating_by_time_class: from goal + by_time_class aggregates.
  const rating_by_time_class: Record<string, number | null> = {};
  for (const tc of Object.keys(aggregates.by_time_class)) {
    // We don't have per-time-class rating in aggregates directly.
    // Use null — this will be enriched by orchestrator with currentRating if available.
    rating_by_time_class[tc] = null;
  }
  // Set goal time class rating from goal.current_rating.
  if (goal.time_class) {
    rating_by_time_class[goal.time_class] = goal.current_rating ?? null;
  }

  const mw = aggregates.maia_weighted;

  // Anchors: compact per-anchor slice (top 10 for history, no exemplars).
  // mine_pct / target_pct: per-anchor averages from Maia (computed in aggregate.ts).
  // null when Maia did not run for that anchor — reported honestly, never fabricated.
  const anchorSlices = (aggregates.anchors ?? []).slice(0, 10).map((a) => {
    return {
      key: a.type,
      label_it: a.label_it,
      count: a.count,
      mine_pct: a.mine_pct ?? null,
      target_pct: a.target_pct ?? null,
      rating_upside: a.rating_upside ?? 0,
    };
  });

  // Transfer snapshot: compact overall by_motif (no windowing — windows are
  // recalculated live from the raw occurrences in aggregates).
  // Use undefined when transfer data is not available (old analysis files).
  let transferSnap: HistorySnapshot["transfer"] | undefined;
  if (aggregates.transfer) {
    const byMotif: TransferMotifStat[] = aggregates.transfer.overall.map((s) => ({ ...s }));
    transferSnap = { by_motif: byMotif };
  }

  return {
    captured_at: now.toISOString(),
    week_iso: toWeekIso(now),
    run_kind,
    games_analyzed: aggregates.games_analyzed,
    rating_by_time_class,
    goal: {
      target: goal.target,
      time_class: goal.time_class,
      current: goal.current_rating ?? null,
      points_needed: goal.points_needed,
      days_left: goal.days_left,
      on_track: goal.on_track,
      projection_at_deadline: goal.projection_at_deadline ?? null,
    },
    maia_weighted: {
      errors_scored: mw?.errors_scored ?? 0,
      avoidable: mw?.avoidable ?? 0,
      mine_pct: mw?.mine_pct ?? null,
      target_pct: mw?.target_pct ?? null,
      gap_pct: mw?.gap_pct ?? null,
      avoidable_share: mw?.avoidable_share ?? null,
    },
    anchors: anchorSlices,
    transfer: transferSnap,
  };
}
