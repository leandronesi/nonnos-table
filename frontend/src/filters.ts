import { useMemo, useState } from "react";
import type { GameRow, Metrics, MonthAgg, ColorAgg, TimeClassAgg, OpeningAgg, Kpi, HeatmapData, PhaseStats, Phase, Color } from "./types";

export interface FilterState {
  timeClass: string | "all";
  rated: "all" | "rated" | "unrated";
  monthFrom: string | null; // "YYYY-MM"
  monthTo: string | null;
}

export const defaultFilters: FilterState = {
  timeClass: "all",
  rated: "all",
  monthFrom: null,
  monthTo: null,
};

export function useFilters() {
  const [f, setF] = useState<FilterState>(defaultFilters);
  const update = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const reset = () => setF(defaultFilters);
  return { f, setF, update, reset };
}

function inRange(month: string | null, from: string | null, to: string | null): boolean {
  if (!month) return false;
  if (from && month < from) return false;
  if (to && month > to) return false;
  return true;
}

function applyFilters(games: GameRow[], f: FilterState): GameRow[] {
  return games.filter((g) => {
    if (f.timeClass !== "all" && g.time_class !== f.timeClass) return false;
    if (f.rated === "rated" && !g.rated) return false;
    if (f.rated === "unrated" && g.rated) return false;
    if ((f.monthFrom || f.monthTo) && !inRange(g.month, f.monthFrom, f.monthTo)) return false;
    return true;
  });
}

// Ricalcolo i medesimi aggregati di backend/metrics.py sui dati filtrati,
// così tutti i grafici reagiscono ai filtri senza un round-trip server.

function safeMean(xs: number[]): number {
  if (!xs.length) return 0;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

function aggByMonth(games: GameRow[]): MonthAgg[] {
  const m = new Map<string, { acpls: number[]; b: number; mi: number; ia: number; n: number; w: number; l: number; d: number }>();
  for (const g of games) {
    if (!g.month) continue;
    const e = m.get(g.month) ?? { acpls: [], b: 0, mi: 0, ia: 0, n: 0, w: 0, l: 0, d: 0 };
    if (g.acpl != null) e.acpls.push(g.acpl);
    e.b += g.counts.blunder;
    e.mi += g.counts.mistake;
    e.ia += g.counts.inaccuracy;
    e.n += 1;
    if (g.result === "win") e.w += 1;
    else if (g.result === "loss") e.l += 1;
    else if (g.result === "draw") e.d += 1;
    m.set(g.month, e);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      acpl: safeMean(v.acpls),
      blunders: v.b,
      mistakes: v.mi,
      inaccuracies: v.ia,
      games: v.n,
      wins: v.w,
      losses: v.l,
      draws: v.d,
      win_rate: v.n ? Math.round((v.w / v.n) * 1000) / 1000 : 0,
      performance: null,
    }));
}

function aggByPhase(games: GameRow[]): Record<Phase, PhaseStats> {
  const out: Record<Phase, PhaseStats> = {
    opening: { moves: 0, cp_loss_sum: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    middlegame: { moves: 0, cp_loss_sum: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    endgame: { moves: 0, cp_loss_sum: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
  };
  for (const g of games) {
    for (const ph of ["opening", "middlegame", "endgame"] as Phase[]) {
      const p = g.by_phase[ph];
      if (!p) continue;
      out[ph].moves += p.moves;
      out[ph].cp_loss_sum += p.cp_loss_sum;
      out[ph].inaccuracy += p.inaccuracy;
      out[ph].mistake += p.mistake;
      out[ph].blunder += p.blunder;
    }
  }
  for (const ph of ["opening", "middlegame", "endgame"] as Phase[]) {
    out[ph].acpl = out[ph].moves ? Math.round((out[ph].cp_loss_sum / out[ph].moves) * 100) / 100 : 0;
  }
  return out;
}

function aggByColor(games: GameRow[]): Record<Color, ColorAgg> {
  const mk = (color: Color): ColorAgg => {
    const subset = games.filter((g) => g.my_color === color);
    const n = subset.length;
    const w = subset.filter((g) => g.result === "win").length;
    const l = subset.filter((g) => g.result === "loss").length;
    const d = subset.filter((g) => g.result === "draw").length;
    const acpls = subset.map((g) => g.acpl ?? null).filter((x): x is number => x != null);
    return {
      games: n,
      wins: w,
      losses: l,
      draws: d,
      win_rate: n ? Math.round((w / n) * 1000) / 1000 : 0,
      acpl: safeMean(acpls),
      blunders: subset.reduce((s, g) => s + g.counts.blunder, 0),
      mistakes: subset.reduce((s, g) => s + g.counts.mistake, 0),
      inaccuracies: subset.reduce((s, g) => s + g.counts.inaccuracy, 0),
      performance: null,
    };
  };
  return { white: mk("white"), black: mk("black") };
}

function aggByTimeClass(games: GameRow[]): TimeClassAgg[] {
  const m = new Map<string, { acpls: number[]; b: number; n: number; w: number }>();
  for (const g of games) {
    const tc = g.time_class || "unknown";
    const e = m.get(tc) ?? { acpls: [], b: 0, n: 0, w: 0 };
    if (g.acpl != null) e.acpls.push(g.acpl);
    e.b += g.counts.blunder;
    e.n += 1;
    if (g.result === "win") e.w += 1;
    m.set(tc, e);
  }
  return [...m.entries()]
    .map(([time_class, v]) => ({
      time_class,
      games: v.n,
      acpl: safeMean(v.acpls),
      blunders: v.b,
      win_rate: v.n ? Math.round((v.w / v.n) * 1000) / 1000 : 0,
      performance: null,
    }))
    .sort((a, b) => b.games - a.games);
}

function aggByOpening(games: GameRow[]): OpeningAgg[] {
  const m = new Map<string, { acpls: number[]; n: number; w: number; b: number; eco: string; opening: string; color: Color | "?" }>();
  for (const g of games) {
    if (!g.eco && !g.opening) continue;
    const key = `${g.eco ?? "—"}|${g.opening ?? "Unknown"}|${g.my_color ?? "?"}`;
    const e = m.get(key) ?? {
      acpls: [],
      n: 0,
      w: 0,
      b: 0,
      eco: g.eco ?? "—",
      opening: g.opening ?? "Unknown",
      color: g.my_color ?? "?",
    };
    if (g.acpl != null) e.acpls.push(g.acpl);
    e.n += 1;
    if (g.result === "win") e.w += 1;
    e.b += g.counts.blunder;
    m.set(key, e);
  }
  return [...m.values()]
    .map((v) => ({
      eco: v.eco,
      opening: v.opening,
      my_color: v.color,
      games: v.n,
      acpl: safeMean(v.acpls),
      win_rate: v.n ? Math.round((v.w / v.n) * 1000) / 1000 : 0,
      blunders: v.b,
      performance: null,
    }))
    .sort((a, b) => b.games - a.games);
}

function buildKpi(games: GameRow[]): Kpi {
  const last30 = games.slice(-30);
  const prev30 = games.length >= 60 ? games.slice(-60, -30) : [];
  const acplRecent = safeMean(last30.map((g) => g.acpl ?? null).filter((x): x is number => x != null));
  const acplPrev = safeMean(prev30.map((g) => g.acpl ?? null).filter((x): x is number => x != null));
  const ratingByTc: Record<string, number> = {};
  for (let i = games.length - 1; i >= 0; i--) {
    const g = games[i];
    if (g.time_class && g.my_rating != null && !(g.time_class in ratingByTc)) {
      ratingByTc[g.time_class] = g.my_rating;
    }
  }
  let totalMoves = 0;
  let totalBlunders = 0;
  for (const g of games) {
    totalBlunders += g.counts.blunder;
    for (const ph of ["opening", "middlegame", "endgame"] as Phase[]) {
      totalMoves += g.by_phase[ph]?.moves ?? 0;
    }
  }
  return {
    games_analyzed: games.length,
    acpl_recent: acplRecent,
    acpl_previous: acplPrev,
    acpl_delta: prev30.length ? Math.round((acplRecent - acplPrev) * 100) / 100 : null,
    rating_by_time_class: ratingByTc,
    blunder_rate: totalMoves ? Math.round((totalBlunders / totalMoves) * 10000) / 10000 : 0,
    total_blunders: totalBlunders,
  };
}

function buildHeatmap(games: GameRow[]): HeatmapData {
  const bins: Array<[number, number]> = [
    [1, 10], [11, 20], [21, 30], [31, 40], [41, 60], [61, 200],
  ];
  const labelOf = (mn: number) => {
    for (const [a, b] of bins) if (mn >= a && mn <= b) return `${a}-${b}`;
    return "61-200";
  };
  const data: Record<string, { opening: number; middlegame: number; endgame: number }> = {};
  for (const [a, b] of bins) data[`${a}-${b}`] = { opening: 0, middlegame: 0, endgame: 0 };
  for (const g of games) {
    const hasEndgameBlunder = (g.by_phase.endgame?.blunder ?? 0) > 0;
    for (const mn of g.blunder_move_numbers || []) {
      const lbl = labelOf(mn);
      let ph: Phase;
      if (mn <= 12) ph = "opening";
      else if (hasEndgameBlunder && mn >= 30) ph = "endgame";
      else ph = "middlegame";
      data[lbl][ph] += 1;
    }
  }
  const labels = bins.map(([a, b]) => `${a}-${b}`);
  return {
    bins: labels,
    data: labels.map((bin) => ({ bin, ...data[bin] })),
  };
}

export function useDerived(metrics: Metrics | null, f: FilterState) {
  return useMemo(() => {
    if (!metrics) return null;
    const games = applyFilters(metrics.games, f);
    return {
      games,
      kpi: buildKpi(games),
      byMonth: aggByMonth(games),
      byPhase: aggByPhase(games),
      byColor: aggByColor(games),
      byTimeClass: aggByTimeClass(games),
      byOpening: aggByOpening(games),
      moveHeatmap: buildHeatmap(games),
    };
  }, [metrics, f]);
}

export function listTimeClasses(metrics: Metrics | null): string[] {
  if (!metrics) return [];
  return [...new Set(metrics.games.map((g) => g.time_class).filter((x): x is string => !!x))];
}

export function listMonths(metrics: Metrics | null): string[] {
  if (!metrics) return [];
  return [...new Set(metrics.games.map((g) => g.month).filter((x): x is string => !!x))].sort();
}
