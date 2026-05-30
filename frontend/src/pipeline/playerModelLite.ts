/**
 * PlayerModelLite — builder browser-side.
 *
 * Produce le slice statistiche del PlayerModel a partire da:
 *   - GameRow[]      (metadati partite da Supabase)
 *   - GameAnalysis[] (analisi Stockfish per-partita, caricate da Storage)
 *   - ProfileRow     (profilo utente con goal e username)
 *
 * Output: PlayerModelLite salvato su quaderno/player_model_lite.json.
 *
 * Slice calcolate:
 *   identity, current_rating, rating_curve, by_color, by_phase,
 *   decisions, tilt, weekly_trend, kpi (Partial, no Maia), openings.
 *
 * Slice omesse (richiedono Maia o backend):
 *   avoidable_blunders, agreement_maia_*, blind_spots, pawn_structures,
 *   turning_points, drills, time_management, coach_brief, coach_session.
 */

import type {
  Identity,
  Goal,
  RatingPoint,
  PhaseStat,
  ColorStat,
  Decisions,
  Tilt,
  WeeklyTrend,
  WeeklyTrendBucket,
  Kpi,
  OpeningStat,
  Confidence,
  Color,
  Phase,
  Result,
  SpentBucket,
  TimeManagement,
  BlindSpot,
} from "../types";
import type { GameRow, ProfileRow } from "../auth/db.types";
import type { GameAnalysis } from "./analyze";

// ── Tipo principale ──────────────────────────────────────────────────────────

export interface PlayerModelLite {
  identity: Identity;
  current_rating: number | null;
  rating_curve: Record<string, RatingPoint[]>;
  by_phase: PhaseStat[];
  by_color: Record<Color, ColorStat>;
  decisions: Decisions;
  tilt: Tilt;
  weekly_trend: WeeklyTrend;
  kpi: Partial<Kpi>;
  openings: OpeningStat[];
  /**
   * Slice gestione-tempo calcolata browser-side.
   * Partial perché clock_vs_accuracy e zeitnot richiedono il clock RIMANENTE,
   * non disponibile nel browser — quei campi sono omessi.
   */
  time_management: Partial<TimeManagement>;
  /**
   * Blind spots da motif v1 (pezzo in presa, ecc.).
   * avoidable_count = 0 perché richiede Maia.
   */
  blind_spots: BlindSpot[];
  generated_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function confidence(n: number): Confidence {
  if (n >= 20) return "high";
  if (n >= 8) return "medium";
  return "low";
}

/** Calcola la media mobile (rolling) di lunghezza `window` su un array di numeri.
 *  Se non ci sono abbastanza elementi precedenti, la media è sui disponibili. */
function rollingAvg(values: number[], idx: number, window: number): number | null {
  if (values.length === 0) return null;
  const start = Math.max(0, idx - window + 1);
  const slice = values.slice(start, idx + 1);
  if (slice.length === 0) return null;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Parsa una stringa ISO o "YYYY.MM.DD" in Date. */
function parseDate(s: string | null): Date | null {
  if (!s) return null;
  // Supabase restituisce ISO: "2024-11-15T14:32:00+00:00"
  // PGN date: "2024.11.15" — normalize
  const normalized = s.replace(/\./g, "-");
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function dateStr(s: string | null): string | null {
  const d = parseDate(s);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / 86400000);
}

// ── Calcolo identity ─────────────────────────────────────────────────────────

function buildIdentity(profile: ProfileRow, games: GameRow[]): Identity {
  const now = new Date();

  // rating_by_time_class: ultima partita per time_class
  const latestByTc: Record<string, { played_at: string; rating: number }> = {};
  for (const g of games) {
    if (g.player_rating == null) continue;
    const prev = latestByTc[g.time_class];
    if (!prev || g.played_at > prev.played_at) {
      latestByTc[g.time_class] = { played_at: g.played_at, rating: g.player_rating };
    }
  }
  const rating_by_time_class: Record<string, number> = {};
  for (const [tc, v] of Object.entries(latestByTc)) {
    rating_by_time_class[tc] = v.rating;
  }

  // last_game_date
  const sortedDates = games.map((g) => g.played_at).sort();
  const last_game_date = sortedDates.length > 0 ? dateStr(sortedDates[sortedDates.length - 1]) : null;

  // Goal
  const goalTc = profile.goal_time_class;
  const currentRatingForGoal = rating_by_time_class[goalTc] ?? null;

  // plan_started_at: usiamo il created_at del profilo come proxy dell'onboarding
  const planStartedAt = dateStr(profile.created_at ?? null);
  const planDate = parseDate(profile.created_at ?? null);
  const deadlineDate = planDate
    ? new Date(planDate.getTime() + profile.goal_horizon_weeks * 7 * 86400000)
    : new Date(now.getTime() + profile.goal_horizon_weeks * 7 * 86400000);
  const deadline = deadlineDate.toISOString().slice(0, 10);

  const daysLeft = Math.max(0, daysBetween(now, deadlineDate));
  const daysSinceStart = planDate ? daysBetween(planDate, now) : 0;

  // startRating: rating of the oldest game in goal_time_class (or oldest overall as fallback)
  const startRating = (() => {
    const tcGames = games.filter((g) => g.player_rating != null && g.time_class === goalTc);
    if (tcGames.length > 0) {
      const oldest = tcGames.reduce((a, b) => (a.played_at < b.played_at ? a : b));
      return oldest.player_rating!;
    }
    const allRated = games.filter((g) => g.player_rating != null);
    if (allRated.length > 0) {
      const oldest = allRated.reduce((a, b) => (a.played_at < b.played_at ? a : b));
      return oldest.player_rating!;
    }
    return currentRatingForGoal;
  })();
  const pointsGained = currentRatingForGoal != null && startRating != null
    ? currentRatingForGoal - startRating
    : 0;
  const pointsNeeded = currentRatingForGoal != null
    ? Math.max(0, profile.goal_rating - currentRatingForGoal)
    : profile.goal_rating;

  const ratePerDaySoFar: number | null =
    daysSinceStart > 0 ? pointsGained / daysSinceStart : null;
  const ratePerDayNeeded: number | null =
    daysLeft > 0 ? pointsNeeded / daysLeft : null;

  const projectionAtDeadline: number | null =
    currentRatingForGoal != null && ratePerDaySoFar != null
      ? Math.round(currentRatingForGoal + ratePerDaySoFar * daysLeft)
      : null;

  const onTrack =
    projectionAtDeadline != null && projectionAtDeadline >= profile.goal_rating;

  const goal: Goal = {
    target: profile.goal_rating,
    time_class: goalTc,
    deadline,
    current_rating: currentRatingForGoal,
    start_rating: startRating,
    points_gained_since_start: pointsGained,
    points_needed: pointsNeeded,
    days_left: daysLeft,
    days_since_start: daysSinceStart,
    rate_per_day_so_far: ratePerDaySoFar,
    rate_per_day_needed: ratePerDayNeeded,
    projection_at_deadline: projectionAtDeadline,
    on_track: onTrack,
  };

  return {
    username: profile.chess_com_username,
    goal,
    rating_by_time_class,
    last_game_date,
    plan_started_at: planStartedAt ?? undefined,
  };
}

// ── current_rating ────────────────────────────────────────────────────────────

function buildCurrentRating(games: GameRow[], profile: ProfileRow): number | null {
  const goalTc = profile.goal_time_class;
  // Partite del goal_time_class ordinate per data desc
  const tcGames = games
    .filter((g) => g.time_class === goalTc && g.player_rating != null)
    .sort((a, b) => (a.played_at < b.played_at ? 1 : -1));
  if (tcGames.length > 0) return tcGames[0].player_rating!;
  // Fallback globale
  const allRated = games
    .filter((g) => g.player_rating != null)
    .sort((a, b) => (a.played_at < b.played_at ? 1 : -1));
  return allRated.length > 0 ? allRated[0].player_rating! : null;
}

// ── rating_curve ──────────────────────────────────────────────────────────────

function buildRatingCurve(games: GameRow[]): Record<string, RatingPoint[]> {
  // Raggruppa per time_class, ordina per played_at asc
  const byTc: Record<string, GameRow[]> = {};
  for (const g of games) {
    if (!byTc[g.time_class]) byTc[g.time_class] = [];
    byTc[g.time_class].push(g);
  }

  const curve: Record<string, RatingPoint[]> = {};
  for (const [tc, tcGames] of Object.entries(byTc)) {
    const sorted = [...tcGames].sort((a, b) => (a.played_at < b.played_at ? -1 : 1));
    const ratings = sorted.map((g) => g.player_rating ?? 0);
    curve[tc] = sorted.map((g, idx) => ({
      epoch: parseDate(g.played_at)?.getTime() ?? 0,
      date: dateStr(g.played_at),
      rating: g.player_rating,
      opp_rating: g.opponent_rating,
      result: g.result as Result | null,
      game_id: g.chess_com_uuid,
      perf_5: rollingAvg(ratings, idx, 5),
      perf_20: rollingAvg(ratings, idx, 20),
    }));
  }
  return curve;
}

// ── by_color ──────────────────────────────────────────────────────────────────

function buildByColor(
  games: GameRow[],
  analyses: GameAnalysis[]
): Record<Color, ColorStat> {
  const analysisMap = new Map<string, GameAnalysis>();
  for (const a of analyses) analysisMap.set(a.chess_com_uuid, a);

  const acc: Record<Color, {
    games: number; wins: number; losses: number; draws: number;
    cpLossSum: number; cpLossMoves: number; oppRatingSum: number; oppRatingCount: number;
  }> = {
    white: { games: 0, wins: 0, losses: 0, draws: 0, cpLossSum: 0, cpLossMoves: 0, oppRatingSum: 0, oppRatingCount: 0 },
    black: { games: 0, wins: 0, losses: 0, draws: 0, cpLossSum: 0, cpLossMoves: 0, oppRatingSum: 0, oppRatingCount: 0 },
  };

  for (const g of games) {
    const c = g.color as Color;
    const a = acc[c];
    a.games++;
    if (g.result === "win") a.wins++;
    else if (g.result === "loss") a.losses++;
    else a.draws++;
    if (g.opponent_rating != null) {
      a.oppRatingSum += g.opponent_rating;
      a.oppRatingCount++;
    }
    const ga = analysisMap.get(g.chess_com_uuid);
    if (ga) {
      a.cpLossSum += ga.avg_cp_loss * ga.total_player_moves;
      a.cpLossMoves += ga.total_player_moves;
    }
  }

  function makeStat(a: typeof acc.white, wins: number, losses: number, games: number): ColorStat {
    const win_rate = games > 0 ? a.wins / games : null;
    const avg_acpl = a.cpLossMoves > 0 ? a.cpLossSum / a.cpLossMoves : 0;
    // Performance = avg(opp_rating) + 400*(W-L)/N
    const avgOpp = a.oppRatingCount > 0 ? a.oppRatingSum / a.oppRatingCount : null;
    const performance = avgOpp != null && games > 0
      ? Math.round(avgOpp + 400 * (wins - losses) / games)
      : null;
    return {
      games,
      wins: a.wins,
      losses: a.losses,
      draws: a.draws,
      win_rate,
      avg_acpl,
      performance,
      confidence: confidence(games),
    };
  }

  return {
    white: makeStat(acc.white, acc.white.wins, acc.white.losses, acc.white.games),
    black: makeStat(acc.black, acc.black.wins, acc.black.losses, acc.black.games),
  };
}

// ── by_phase ──────────────────────────────────────────────────────────────────

function buildByPhase(analyses: GameAnalysis[]): PhaseStat[] {
  const phases: Phase[] = ["opening", "middlegame", "endgame"];
  const acc: Record<Phase, { moves: number; blunders: number; cpLossSum: number }> = {
    opening: { moves: 0, blunders: 0, cpLossSum: 0 },
    middlegame: { moves: 0, blunders: 0, cpLossSum: 0 },
    endgame: { moves: 0, blunders: 0, cpLossSum: 0 },
  };

  for (const ga of analyses) {
    for (const phase of phases) {
      const p = ga.by_phase[phase];
      acc[phase].moves += p.moves;
      acc[phase].blunders += p.blunders;
      acc[phase].cpLossSum += p.avg_cp_loss * p.moves;
    }
  }

  return phases.map((phase) => {
    const a = acc[phase];
    const blunder_rate = a.moves > 0 ? a.blunders / a.moves : null;
    const avg_cp_loss = a.moves > 0 ? a.cpLossSum / a.moves : 0;
    return {
      phase,
      positions: a.moves,
      avg_cp_loss,
      blunders: a.blunders,
      // avoidable_blunders richiede Maia → usiamo 0 come placeholder
      avoidable_blunders: 0,
      blunder_rate,
      confidence: confidence(a.moves),
    };
  });
}

// ── decisions ────────────────────────────────────────────────────────────────

function buildDecisions(games: GameRow[], analyses: GameAnalysis[]): Decisions {
  const analysisMap = new Map<string, GameAnalysis>();
  for (const a of analyses) analysisMap.set(a.chess_com_uuid, a);

  let reached_winning = 0;
  let converted_winning = 0;
  let blew_winning = 0;
  let reached_losing = 0;
  let saved_losing = 0;

  for (const g of games) {
    const ga = analysisMap.get(g.chess_com_uuid);
    if (!ga) continue;

    const hasWinning = ga.moves.some((m) => m.scoreAfterCp >= 200);
    const hasLosing  = ga.moves.some((m) => m.scoreAfterCp <= -200);

    if (hasWinning) {
      reached_winning++;
      if (g.result === "win") converted_winning++;
      else blew_winning++;
    }
    if (hasLosing) {
      reached_losing++;
      if (g.result === "win" || g.result === "draw") saved_losing++;
    }
  }

  const n = analyses.length;
  const conversion_rate = reached_winning > 0 ? converted_winning / reached_winning : null;
  const blow_rate       = reached_winning > 0 ? blew_winning / reached_winning : null;
  const save_rate       = reached_losing  > 0 ? saved_losing  / reached_losing  : null;

  return {
    games: n,
    reached_winning,
    converted_winning,
    conversion_rate,
    blew_winning,
    blow_rate,
    reached_losing,
    saved_losing,
    save_rate,
    confidence_conversion: confidence(reached_winning),
    confidence_save:       confidence(reached_losing),
  };
}

// ── tilt ──────────────────────────────────────────────────────────────────────

function buildTilt(analyses: GameAnalysis[]): Tilt {
  let postBlunderCpSum = 0;
  let postBlunderN = 0;
  let baselineCpSum = 0;
  let baselineN = 0;

  for (const ga of analyses) {
    let inPostBlunder = false;
    for (const mv of ga.moves) {
      if (mv.category === "blunder") {
        inPostBlunder = true;
        // La mossa blunder stessa va nel baseline
        baselineCpSum += mv.cpLoss;
        baselineN++;
        continue;
      }
      if (inPostBlunder) {
        postBlunderCpSum += mv.cpLoss;
        postBlunderN++;
      } else {
        baselineCpSum += mv.cpLoss;
        baselineN++;
      }
      // Reset dopo la prima mossa post-blunder (vogliamo solo 1 mossa dopo)
      // Oppure lasciamo aperto fino al prossimo blunder — lascio aperto.
    }
  }

  const after_blunder_avg_cp_loss = postBlunderN > 0 ? postBlunderCpSum / postBlunderN : 0;
  const baseline_avg_cp_loss      = baselineN > 0    ? baselineCpSum    / baselineN    : 0;
  const tilt_factor = baseline_avg_cp_loss > 0
    ? after_blunder_avg_cp_loss / baseline_avg_cp_loss
    : 1;

  return {
    after_blunder_avg_cp_loss,
    after_blunder_n: postBlunderN,
    baseline_avg_cp_loss,
    baseline_n: baselineN,
    tilt_factor,
  };
}

// ── weekly_trend ─────────────────────────────────────────────────────────────

function buildWeeklyTrend(games: GameRow[], analyses: GameAnalysis[]): WeeklyTrend {
  const analysisMap = new Map<string, GameAnalysis>();
  for (const a of analyses) analysisMap.set(a.chess_com_uuid, a);

  const now = new Date();
  const ms7 = 7 * 86400000;
  const cutLast = new Date(now.getTime() - ms7);
  const cutPrev  = new Date(now.getTime() - 2 * ms7);

  const emptyBucket = (): WeeklyTrendBucket => ({
    n_games: 0, wins: 0, win_rate: null, n_critical: 0,
    avg_cp_loss: 0, n_blunders: 0, blunder_rate: null,
  });

  const last: WeeklyTrendBucket & { cpLossSum: number; totalMoves: number } = { ...emptyBucket(), cpLossSum: 0, totalMoves: 0 };
  const prev: WeeklyTrendBucket & { cpLossSum: number; totalMoves: number } = { ...emptyBucket(), cpLossSum: 0, totalMoves: 0 };

  for (const g of games) {
    const d = parseDate(g.played_at);
    if (!d) continue;
    const isLast = d >= cutLast && d <= now;
    const isPrev = d >= cutPrev && d < cutLast;
    if (!isLast && !isPrev) continue;

    const bucket = isLast ? last : prev;
    bucket.n_games++;
    if (g.result === "win") bucket.wins++;

    const ga = analysisMap.get(g.chess_com_uuid);
    if (ga) {
      bucket.n_blunders += ga.blunders;
      bucket.cpLossSum  += ga.avg_cp_loss * ga.total_player_moves;
      bucket.totalMoves += ga.total_player_moves;
      // critical = mossa con scoreBeforeCp >= 100
      bucket.n_critical += ga.moves.filter((m) => m.scoreBeforeCp >= 100).length;
    }
  }

  function finalize(b: typeof last): WeeklyTrendBucket {
    return {
      n_games: b.n_games,
      wins: b.wins,
      win_rate: b.n_games > 0 ? b.wins / b.n_games : null,
      n_critical: b.n_critical,
      avg_cp_loss: b.totalMoves > 0 ? b.cpLossSum / b.totalMoves : 0,
      n_blunders: b.n_blunders,
      blunder_rate: b.totalMoves > 0 ? b.n_blunders / b.totalMoves : null,
    };
  }

  const lastF = finalize(last);
  const prevF = finalize(prev);

  const deltaWinRate = lastF.win_rate != null && prevF.win_rate != null
    ? lastF.win_rate - prevF.win_rate
    : null;
  const deltaBlunderRate = lastF.blunder_rate != null && prevF.blunder_rate != null
    ? lastF.blunder_rate - prevF.blunder_rate
    : null;

  return {
    last_7d: lastF,
    prev_7d: prevF,
    delta: {
      n_games:      lastF.n_games     - prevF.n_games,
      win_rate:     deltaWinRate,
      avg_cp_loss:  lastF.avg_cp_loss - prevF.avg_cp_loss,
      n_blunders:   lastF.n_blunders  - prevF.n_blunders,
      blunder_rate: deltaBlunderRate,
    },
  };
}

// ── kpi ───────────────────────────────────────────────────────────────────────

function buildKpi(games: GameRow[], analyses: GameAnalysis[]): Partial<Kpi> {
  const now = new Date();
  const cutRecent   = new Date(now.getTime() - 30 * 86400000);
  const cutPrevious = new Date(now.getTime() - 60 * 86400000);

  const analysisMap = new Map<string, GameAnalysis>();
  for (const a of analyses) analysisMap.set(a.chess_com_uuid, a);

  let totalBlunders = 0;
  let totalCritical = 0; // posizioni con scoreBeforeCp >= 100
  let totalMoves = 0;
  let totalCpLossSum = 0;

  let recentCpSum = 0; let recentMoves = 0;
  let prevCpSum = 0;   let prevMoves = 0;

  for (const g of games) {
    const ga = analysisMap.get(g.chess_com_uuid);
    if (!ga) continue;
    const d = parseDate(g.played_at);

    totalBlunders += ga.blunders;
    totalMoves    += ga.total_player_moves;
    totalCpLossSum += ga.avg_cp_loss * ga.total_player_moves;

    for (const mv of ga.moves) {
      if (mv.scoreBeforeCp >= 100) totalCritical++;
    }

    if (d) {
      if (d >= cutRecent) {
        recentCpSum  += ga.avg_cp_loss * ga.total_player_moves;
        recentMoves  += ga.total_player_moves;
      } else if (d >= cutPrevious && d < cutRecent) {
        prevCpSum  += ga.avg_cp_loss * ga.total_player_moves;
        prevMoves  += ga.total_player_moves;
      }
    }
  }

  const acpl_recent_30   = recentMoves   > 0 ? recentCpSum   / recentMoves   : null;
  const acpl_previous_30 = prevMoves     > 0 ? prevCpSum     / prevMoves     : null;
  const acpl_delta = acpl_recent_30 != null && acpl_previous_30 != null
    ? acpl_recent_30 - acpl_previous_30
    : null;

  // avg_cp_loss_on_critical: media del cpLoss sulle posizioni critiche
  let critCpSum = 0; let critN = 0;
  for (const ga of analyses) {
    for (const mv of ga.moves) {
      if (mv.scoreBeforeCp >= 100) { critCpSum += mv.cpLoss; critN++; }
    }
  }
  const avg_cp_loss_on_critical = critN > 0 ? critCpSum / critN : 0;
  const blunders_critical = analyses.reduce((sum, ga) =>
    sum + ga.moves.filter((m) => m.scoreBeforeCp >= 100 && m.category === "blunder").length, 0);

  // totalBlunders viene usato solo come aggregato interno; Kpi espone blunders_critical (solo su pos critiche).
  void totalBlunders;

  return {
    games_analyzed:          analyses.length,
    critical_positions:      totalCritical,
    avg_cp_loss_on_critical,
    blunders_critical,
    acpl_recent_30,
    acpl_previous_30,
    acpl_delta,
    // Maia fields omessi: avoidable_blunders, agreement_maia_mine_pct, agreement_maia_target_pct
  };
}

// ── openings ─────────────────────────────────────────────────────────────────

function buildOpenings(games: GameRow[], analyses: GameAnalysis[]): OpeningStat[] {
  const analysisMap = new Map<string, GameAnalysis>();
  for (const a of analyses) analysisMap.set(a.chess_com_uuid, a);

  // Mappa per (eco|opening, color) → accumulatore
  type Key = string;
  const acc: Map<Key, {
    eco: string; opening: string; my_color: Color;
    games: number; wins: number; cpLossSum: number; cpLossMoves: number;
  }> = new Map();

  for (const g of games) {
    const ga = analysisMap.get(g.chess_com_uuid);
    if (!ga) continue;
    const eco = ga.eco ?? "??";
    const opening = ga.opening ?? "Unknown";
    const color = g.color as Color;
    const key: Key = `${eco}|${opening}|${color}`;
    if (!acc.has(key)) {
      acc.set(key, { eco, opening, my_color: color, games: 0, wins: 0, cpLossSum: 0, cpLossMoves: 0 });
    }
    const a = acc.get(key)!;
    a.games++;
    if (g.result === "win") a.wins++;
    a.cpLossSum   += ga.avg_cp_loss * ga.total_player_moves;
    a.cpLossMoves += ga.total_player_moves;
  }

  const result: OpeningStat[] = [];
  for (const a of acc.values()) {
    result.push({
      eco:      a.eco,
      opening:  a.opening,
      my_color: a.my_color,
      games:    a.games,
      win_rate: a.games > 0 ? a.wins / a.games : null,
      avg_acpl: a.cpLossMoves > 0 ? a.cpLossSum / a.cpLossMoves : 0,
      confidence: confidence(a.games),
    });
  }

  // Ordina per games desc, top 10
  result.sort((a, b) => b.games - a.games);
  return result.slice(0, 10);
}

// ── time_management ───────────────────────────────────────────────────────────

/**
 * Definizione dei bucket "tempo speso sulla mossa".
 * La chiave `lt_1s` / `gt_30s` è riconosciuta da SpeedVsErrorsChart
 * per il verdetto rapido/riflessivo, quindi usiamo bucket coerenti.
 */
const SPENT_BUCKETS: { key: string; bucket: string; min: number; max: number }[] = [
  { key: "lt_5s",  bucket: "< 5 s",   min: 0,  max: 5 },
  { key: "5_15s",  bucket: "5-15 s",  min: 5,  max: 15 },
  { key: "15_30s", bucket: "15-30 s", min: 15, max: 30 },
  { key: "30_60s", bucket: "30-60 s", min: 30, max: 60 },
  { key: "gt_60s", bucket: "> 60 s",  min: 60, max: Infinity },
];

/**
 * Calcola la slice time_management dal lato browser.
 *
 * Campi calcolati:
 *   spent_vs_accuracy — da spentSeconds (disponibile).
 *   instant_moves_in_critical — mosse < 5 s con scoreBeforeCp >= 100.
 *
 * Campi NON calcolati (richiedono clock RIMANENTE — TODO):
 *   clock_vs_accuracy — TODO: richiede clock-rimanente, non estratto dal browser.
 *   zeitnot           — TODO: richiede clock-rimanente, non estratto dal browser.
 */
function buildTimeManagement(analyses: GameAnalysis[]): Partial<TimeManagement> {
  // ── spent_vs_accuracy ────────────────────────────────────────────────────

  type BucketAcc = {
    positions: number;
    cpLossSum: number;
    errors: number;      // mistake + blunder
    blunders: number;
  };

  const acc: Record<string, BucketAcc> = {};
  for (const b of SPENT_BUCKETS) {
    acc[b.key] = { positions: 0, cpLossSum: 0, errors: 0, blunders: 0 };
  }

  // instant_moves_in_critical (spentSeconds < 5 AND scoreBeforeCp >= 100)
  let instantCritN = 0;
  let instantCritCpSum = 0;
  let instantCritBlunders = 0;

  for (const ga of analyses) {
    for (const mv of ga.moves) {
      if (mv.spentSeconds == null) continue;

      const s = mv.spentSeconds;
      const b = SPENT_BUCKETS.find((b) => s >= b.min && s < b.max);
      if (!b) continue;

      const a = acc[b.key];
      a.positions++;
      a.cpLossSum += mv.cpLoss;
      if (mv.category === "mistake" || mv.category === "blunder") a.errors++;
      if (mv.category === "blunder") a.blunders++;

      // instant_moves_in_critical: mossa rapida in posizione critica
      if (s < 5 && mv.scoreBeforeCp >= 100) {
        instantCritN++;
        instantCritCpSum += mv.cpLoss;
        if (mv.category === "blunder") instantCritBlunders++;
      }
    }
  }

  const spent_vs_accuracy: SpentBucket[] = SPENT_BUCKETS
    .filter((b) => acc[b.key].positions > 0)
    .map((b) => {
      const a = acc[b.key];
      return {
        bucket: b.bucket,
        key: b.key,
        positions: a.positions,
        avg_cp_loss: Math.round(a.cpLossSum / a.positions),
        blunders: a.blunders,
        errors: a.errors,
        error_rate: a.positions > 0 ? a.errors / a.positions : 0,
        // avoidable_errors / avoidable_share richiedono Maia → omessi (optional nel tipo)
        // avg_gap richiederebbe confronto con target → omesso (optional nel tipo)
      };
    });

  const instant_moves_in_critical = {
    n: instantCritN,
    avg_cp_loss: instantCritN > 0 ? Math.round(instantCritCpSum / instantCritN) : 0,
    blunders: instantCritBlunders,
  };

  // clock_vs_accuracy e zeitnot richiedono clock-rimanente — TODO
  return {
    spent_vs_accuracy,
    instant_moves_in_critical,
    // clock_vs_accuracy: omesso — richiede clock-rimanente, TODO
    // zeitnot: omesso — richiede clock-rimanente, TODO
  };
}

// ── blind_spots ───────────────────────────────────────────────────────────────

/** Mappa motif-key → label italiana. */
const MOTIF_LABEL_IT: Record<string, string> = {
  pezzo_in_presa: "Pezzo lasciato in presa",
};

/**
 * Raggruppa le mosse con motif != null e produce un BlindSpot per motif.
 * avoidable_count = 0 (richiede Maia — non disponibile browser-side).
 */
function buildBlindSpots(analyses: GameAnalysis[]): BlindSpot[] {
  const acc: Map<string, { n: number; cpLossSum: number }> = new Map();

  for (const ga of analyses) {
    for (const mv of ga.moves) {
      if (!mv.motif) continue;
      const prev = acc.get(mv.motif) ?? { n: 0, cpLossSum: 0 };
      acc.set(mv.motif, { n: prev.n + 1, cpLossSum: prev.cpLossSum + mv.cpLoss });
    }
  }

  const result: BlindSpot[] = [];
  for (const [motif, data] of acc.entries()) {
    result.push({
      motif,
      label_it: MOTIF_LABEL_IT[motif] ?? motif,
      n: data.n,
      avoidable_count: 0, // Maia non disponibile browser-side
      avg_cp_loss: data.n > 0 ? data.cpLossSum / data.n : 0,
      confidence: confidence(data.n),
    });
  }

  // Ordina per frequenza desc
  result.sort((a, b) => b.n - a.n);
  return result;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Costruisce il PlayerModelLite a partire dai dati grezzi browser-side.
 *
 * @param games     GameRow[] — tutte le partite dell'utente (con analysis_status='done').
 * @param analyses  GameAnalysis[] — analisi Stockfish corrispondenti.
 * @param profile   ProfileRow — profilo utente.
 */
export function buildPlayerModelLite(
  games: GameRow[],
  analyses: GameAnalysis[],
  profile: ProfileRow
): PlayerModelLite {
  return {
    identity:         buildIdentity(profile, games),
    current_rating:   buildCurrentRating(games, profile),
    rating_curve:     buildRatingCurve(games),
    by_color:         buildByColor(games, analyses),
    by_phase:         buildByPhase(analyses),
    decisions:        buildDecisions(games, analyses),
    tilt:             buildTilt(analyses),
    weekly_trend:     buildWeeklyTrend(games, analyses),
    kpi:              buildKpi(games, analyses),
    openings:         buildOpenings(games, analyses),
    time_management:  buildTimeManagement(analyses),
    blind_spots:      buildBlindSpots(analyses),
    generated_at:     new Date().toISOString(),
  };
}
