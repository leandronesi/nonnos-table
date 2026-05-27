/**
 * Drill log — tracking locale degli allenamenti pattern-specifici.
 *
 * Modello: per ogni pattern (key) memorizziamo le sessioni di drill fatte —
 * timestamp + verdetti delle posizioni. Serve a:
 *   1. mostrare "allenato oggi N volte" su PatternDetail
 *   2. far evolvere lo stato SRS del pattern (mastered se hai N perfect)
 *   3. premiare lo sforzo in Home
 *
 * Persistenza: localStorage chiave `mygotham_drill_log`. Schema versionato.
 */

import { todayUTC } from "./store";
import { writeEntry, bodyForDrillRun, hasEntryToday, bodyForFirstDrill } from "./journal";

const STORAGE_KEY = "mygotham_drill_log";
const SCHEMA = 1;

export type DrillVerdict = "perfect" | "ok" | "wrong";

export interface DrillPositionLog {
  game_id: string;
  ply: number;
  verdict: DrillVerdict;
  attempts: number;
  cp_loss: number | null;
  at: number;       // epoch ms
}

export interface DrillRun {
  pattern_key: string;
  date: string;            // YYYY-MM-DD UTC
  started_at: number;
  finished_at?: number;
  positions: DrillPositionLog[];
}

export interface DrillLog {
  schema: number;
  runs: DrillRun[];
}

function loadRaw(): DrillLog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { schema: SCHEMA, runs: [] };
    const parsed = JSON.parse(raw) as DrillLog;
    if ((parsed.schema ?? 0) < SCHEMA) {
      localStorage.removeItem(STORAGE_KEY);
      return { schema: SCHEMA, runs: [] };
    }
    return parsed;
  } catch {
    return { schema: SCHEMA, runs: [] };
  }
}

function saveRaw(log: DrillLog) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch { /* full / disabled localStorage → silent */ }
}

/** Inizia (o riusa) una drill run per il pattern oggi. */
export function startDrillRun(pattern_key: string, pattern_name?: string): DrillRun {
  const log = loadRaw();
  const today = todayUTC();
  // Cerco una run aperta per oggi su questo pattern
  const open = log.runs.find(
    (r) => r.pattern_key === pattern_key && r.date === today && !r.finished_at,
  );
  if (open) return open;
  const run: DrillRun = {
    pattern_key,
    date: today,
    started_at: Date.now(),
    positions: [],
  };
  log.runs.push(run);
  saveRaw(log);
  // Journal: prima volta in assoluto su questo pattern?
  const isFirstEver = !log.runs.some(
    (r) => r.pattern_key === pattern_key && r.started_at < run.started_at,
  );
  if (isFirstEver && pattern_name && !hasEntryToday("first_drill", pattern_key)) {
    writeEntry({
      kind: "first_drill",
      pattern_key,
      body: bodyForFirstDrill(pattern_name),
    });
  }
  return run;
}

/** Aggiunge il verdetto di una posizione alla run corrente. */
export function logDrillPosition(pattern_key: string, p: DrillPositionLog) {
  const log = loadRaw();
  const today = todayUTC();
  const run = log.runs.find(
    (r) => r.pattern_key === pattern_key && r.date === today && !r.finished_at,
  );
  if (!run) return;
  run.positions.push(p);
  saveRaw(log);
}

/** Chiude la run corrente. */
export function finishDrillRun(pattern_key: string, pattern_name?: string) {
  const log = loadRaw();
  const today = todayUTC();
  const run = log.runs.find(
    (r) => r.pattern_key === pattern_key && r.date === today && !r.finished_at,
  );
  if (!run) return;
  run.finished_at = Date.now();
  saveRaw(log);
  // Journal entry: scrivi il riepilogo della run
  if (pattern_name && run.positions.length > 0) {
    const perfect = run.positions.filter((p) => p.verdict === "perfect").length;
    const ok = run.positions.filter((p) => p.verdict === "ok").length;
    const wrong = run.positions.filter((p) => p.verdict === "wrong").length;
    writeEntry({
      kind: "drill_completed",
      pattern_key,
      body: bodyForDrillRun(pattern_name, perfect, ok, wrong),
      meta: { perfect, ok, wrong, total: run.positions.length },
    });
  }
}

/** Run per pattern oggi. */
export function todayRuns(): DrillRun[] {
  const log = loadRaw();
  const today = todayUTC();
  return log.runs.filter((r) => r.date === today);
}

/** Tutte le run di un pattern, ordinate desc per data. */
export function runsForPattern(pattern_key: string): DrillRun[] {
  const log = loadRaw();
  return log.runs
    .filter((r) => r.pattern_key === pattern_key)
    .sort((a, b) => (b.date.localeCompare(a.date)));
}

/** Statistica veloce di un pattern allenato. */
export interface PatternDrillStats {
  total_runs: number;
  total_positions: number;
  perfect: number;
  ok: number;
  wrong: number;
  last_run_at: number | null;
  done_today: boolean;
}

export function patternStats(pattern_key: string): PatternDrillStats {
  const runs = runsForPattern(pattern_key);
  const today = todayUTC();
  const stats: PatternDrillStats = {
    total_runs: runs.length,
    total_positions: 0,
    perfect: 0, ok: 0, wrong: 0,
    last_run_at: null,
    done_today: false,
  };
  for (const r of runs) {
    if (r.date === today && (r.finished_at != null || r.positions.length > 0)) stats.done_today = true;
    if (r.finished_at != null) {
      if (stats.last_run_at == null || r.finished_at > stats.last_run_at) {
        stats.last_run_at = r.finished_at;
      }
    }
    for (const p of r.positions) {
      stats.total_positions += 1;
      if (p.verdict === "perfect") stats.perfect += 1;
      else if (p.verdict === "ok") stats.ok += 1;
      else stats.wrong += 1;
    }
  }
  return stats;
}
