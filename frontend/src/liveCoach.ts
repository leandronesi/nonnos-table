/**
 * Live Coach — chiamata HTTP al backend per generare brief contestuale.
 *
 * Il backend Python (server.py) riceve lo STATO CORRENTE dell'utente
 * (rating, target, streak, freni top, journal recente) e ritorna una
 * micro-risposta da Nonno generata via LLM.
 *
 * Layer di cache locale: salviamo l'ultima risposta in localStorage con
 * timestamp + hash dell'input. Riusiamo per max 1h o finche` l'input
 * non cambia. Stessa logica del cache server-side, in modo che 99%
 * delle aperture pagina NON facciano una chiamata API.
 */

import type { PlayerModel } from "./types";
import { buildPatterns, type Pattern } from "./patterns";
import { loadStreak } from "./session/store";
import { readEntries, type JournalEntry } from "./session/journal";
import { patternStats } from "./session/drillLog";

const STORAGE_KEY = "mygotham_live_coach_cache";
const CACHE_TTL_MS = 60 * 60 * 1000;  // 1h
const API_BASE = import.meta.env.VITE_API_BASE || "/api";

// ---------------------------------------------------------------------------
// Types (in sync con server.py)
// ---------------------------------------------------------------------------

export interface LiveCoachResponse {
  headline: string;
  body: string;
  suggested_focus_pattern_key: string | null;
  generated_at: string;
  model: string;
  cached: boolean;
}

interface FrenoSummary {
  name: string;
  category: string;
  current_share: number;
  trend: string;
  avoidable_count: number;
  avg_drill_value: number;
  impact_score: number;
  drill_runs_total: number;
  drill_done_today: boolean;
  last_drill_outcome: string | null;
}

interface JournalEntrySummary {
  date: string;
  kind: string;
  body: string;
}

export interface LiveCoachRequest {
  username: string;
  current_rating: number | null;
  target_rating: number;
  time_class: string;
  days_to_deadline: number | null;
  streak_current: number;
  streak_best: number;
  rating_delta_30d: number | null;
  top_freni: FrenoSummary[];
  recent_journal: JournalEntrySummary[];
  focus_pattern_key?: string;
}

// ---------------------------------------------------------------------------
// Build request payload from PlayerModel + localStorage state
// ---------------------------------------------------------------------------

function lastDrillOutcomeFor(key: string): string | null {
  const stats = patternStats(key);
  if (stats.total_positions === 0) return null;
  if (stats.wrong === 0 && stats.perfect === stats.total_positions) return "all_perfect";
  if (stats.wrong === 0) return "no_wrong";
  if (stats.perfect >= stats.wrong) return "mostly_right";
  return "mostly_wrong";
}

export function buildLiveCoachRequest(
  pm: PlayerModel,
  focus_pattern_key?: string,
): LiveCoachRequest {
  const patterns = buildPatterns(pm);
  const streak = loadStreak();
  const journal = readEntries(15);

  const top: FrenoSummary[] = patterns
    .filter((p: Pattern) => p.positions.length > 0)
    .slice()
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, 7)
    .map((p) => ({
      name: p.name,
      category: p.category,
      current_share: p.current_share,
      trend: p.trend,
      avoidable_count: p.avoidable_count,
      avg_drill_value: p.avg_drill_value,
      impact_score: p.impact_score,
      drill_runs_total: p.drill_stats.total_runs,
      drill_done_today: p.drill_stats.done_today,
      last_drill_outcome: lastDrillOutcomeFor(p.key),
    }));

  const recent: JournalEntrySummary[] = journal.map((e: JournalEntry) => ({
    date: e.date,
    kind: e.kind,
    body: e.body,
  }));

  return {
    username: pm.identity.username,
    current_rating: pm.identity.goal.current_rating,
    target_rating: pm.identity.goal.target,
    time_class: pm.identity.goal.time_class || "rapid",
    days_to_deadline: pm.identity.goal.days_left ?? null,
    streak_current: streak.current,
    streak_best: streak.best,
    rating_delta_30d: pm.identity.goal.recent_progression?.last_30d?.delta ?? null,
    top_freni: top,
    recent_journal: recent,
    focus_pattern_key,
  };
}

// ---------------------------------------------------------------------------
// Hash + cache
// ---------------------------------------------------------------------------

function hashRequest(req: LiveCoachRequest): string {
  // Hash semplice del JSON. Non crypto-secure, va bene per cache key.
  const str = JSON.stringify(req);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

interface CacheEntry {
  hash: string;
  at: number;
  resp: LiveCoachResponse;
}

function loadCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCache(c: CacheEntry) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch { /* ignore */ }
}

export function clearLiveCoachCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Main fetch
// ---------------------------------------------------------------------------

export interface FetchOptions {
  /** Se true, ignora la cache e forza la chiamata. */
  force?: boolean;
}

export async function fetchLiveCoach(
  pm: PlayerModel,
  options: FetchOptions = {},
): Promise<LiveCoachResponse> {
  const req = buildLiveCoachRequest(pm);
  const hash = hashRequest(req);

  if (!options.force) {
    const cached = loadCache();
    if (
      cached &&
      cached.hash === hash &&
      Date.now() - cached.at < CACHE_TTL_MS
    ) {
      return { ...cached.resp, cached: true };
    }
  }

  const url = `${API_BASE}/coach/live${options.force ? "?force=true" : ""}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Live coach error ${resp.status}: ${detail}`);
  }
  const data = (await resp.json()) as LiveCoachResponse;
  saveCache({ hash, at: Date.now(), resp: data });
  return data;
}

/** Tira fuori la risposta cached SE valida, senza fare fetch. */
export function getCachedLiveCoach(pm: PlayerModel): LiveCoachResponse | null {
  const cached = loadCache();
  if (!cached) return null;
  const req = buildLiveCoachRequest(pm);
  const hash = hashRequest(req);
  if (cached.hash !== hash) return null;
  if (Date.now() - cached.at >= CACHE_TTL_MS) return null;
  return { ...cached.resp, cached: true };
}
