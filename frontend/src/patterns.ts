// OOUX — il Pattern come oggetto navigabile.
//
// Aggrega PatternEvolution (da growth_delta) + posizioni cross-game taggate
// con il motivo corrispondente. Espone tutto cio` che serve a una pagina
// detail e a una collezione: nome, frequenza %, trend, ultima occorrenza,
// stato SRS, serie temporale, occorrenze.

import type {
  PlayerModel,
  PatternEvolution,
  PatternWeeklyPoint,
  PositionRow,
} from "./types";
import { patternStats, type PatternDrillStats } from "./session/drillLog";

export type PatternCategory = PatternEvolution["category"];
export type PatternTrend = PatternEvolution["trend"];
export type PatternMagnitude = PatternEvolution["magnitude"];
export type PatternSrsState = "fresh" | "decaying" | "mastered" | "new";

export interface Pattern {
  /** Chiave canonica (es. "motif_hanging_piece", "tilt_post_blunder"). URL-safe. */
  key: string;
  /** Chiave breve senza prefix (es. "hanging_piece"). Usata per matchare PositionRow.motif. */
  shortKey: string;
  /** Nome italiano (es. "Pezzo in presa"). Il display name. */
  name: string;
  category: PatternCategory;
  /** Share in [0,1] nella finestra corrente. Display: moltiplica per 100. */
  current_share: number;
  previous_share: number;
  trend: PatternTrend;
  magnitude: PatternMagnitude;
  weekly_series: PatternWeeklyPoint[];
  phrase_hint: string;
  /** Posizioni cross-game taggate con questo pattern. Ordinate desc per DRILL_VALUE (poi cp_loss). */
  positions: PositionRow[];
  /** L'occorrenza più recente, o null se nessuna posizione. */
  last_occurrence: PositionRow | null;
  /** Stato SRS derivato (fresh/decaying/mastered/new). */
  srs_state: PatternSrsState;
  /** Numero di posizioni "evitabili al tuo livello" (drill_value medio-alto OR avoidable_at_my_level=1). */
  avoidable_count: number;
  /** Drill value medio: p_target_plays_best − p_mine_plays_best. Più alto = più "money" da allenare. */
  avg_drill_value: number;
  /** Cp_loss medio delle occorrenze (gravità tipica). */
  avg_cp_loss: number;
  /**
   * Impact score: quanto questo pattern ti tira giù verso l'obiettivo.
   * Composto: current_share × (1 + avg_drill_value × 4) × (avg_cp_loss / 100).
   * Più alto = più freno verso il target dichiarato.
   */
  impact_score: number;
  /** Statistiche di allenamento lifetime su questo pattern (da localStorage). */
  drill_stats: PatternDrillStats;
  /**
   * Score di priorità per OGGI: combina impact_score con "ho gia` drillato oggi?",
   * "quanto tempo è passato dall'ultima drill?", "wrong count recente?". Più alto
   * = piu` urgente da proporre oggi.
   */
  priority_today: number;
  /** Se true, il sistema raccomanda di allenarlo OGGI. */
  recommended_today: boolean;
}

/** Build all Patterns from a PlayerModel. */
export function buildPatterns(pm: PlayerModel): Pattern[] {
  const positions: PositionRow[] = [...pm.drills, ...pm.turning_points];
  const evolutions = pm.growth_delta?.patterns ?? [];
  return evolutions.map((ev) => buildOne(ev, positions));
}

export function findPattern(pm: PlayerModel, key: string): Pattern | null {
  return buildPatterns(pm).find((p) => p.key === key) ?? null;
}

function buildOne(ev: PatternEvolution, positions: PositionRow[]): Pattern {
  const shortKey = ev.key.replace(/^motif_/, "");
  const matching = filterPositionsByPattern(positions, ev.key, shortKey);

  // Ordinamento principale per DRILL_VALUE desc (le posizioni "money": evitabili
  // al tuo livello e raggiungibili dal target). Fallback a cp_loss desc, poi data.
  const sortedByValue = matching.slice().sort((a, b) => {
    const dva = drillValueOf(a);
    const dvb = drillValueOf(b);
    if (dvb !== dva) return dvb - dva;
    if (b.cp_loss !== a.cp_loss) return b.cp_loss - a.cp_loss;
    return (b.date ?? "").localeCompare(a.date ?? "");
  });

  // Per "ultima volta" ci serve l'ordinamento per data
  const last_occurrence = matching.length > 0
    ? matching.slice().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0]
    : null;

  // Derived metrics
  const avg_drill_value = mean(matching.map(drillValueOf));
  const avg_cp_loss = mean(matching.map((p) => p.cp_loss));
  const avoidable_count = matching.filter(isAvoidableAtMyLevel).length;
  // Impact score: combina frequenza × evitabilita` × gravita`. Pattern raro ma
  // FACILE per il tuo livello pesa quanto un pattern frequente ma difficile.
  const impact_score =
    ev.current_share *
    (1 + Math.max(0, avg_drill_value) * 4) *
    (Math.max(0, avg_cp_loss) / 100);

  // Drill stats lifetime
  const drill_stats = patternStats(ev.key);

  // Stato SRS arricchito col drill log (mastered/decaying si guadagnano allenando)
  const srs_state = deriveSrsState(ev, sortedByValue, drill_stats);

  // Priorita` per OGGI: skip pattern gia` allenati oggi; boost se mai
  // allenato; boost se non allenato da N giorni; boost se ultima run wrong
  const priority_today = computePriorityToday(impact_score, drill_stats, srs_state);
  const recommended_today =
    matching.length > 0 && !drill_stats.done_today && srs_state !== "mastered";

  return {
    key: ev.key,
    shortKey,
    name: ev.label_it,
    category: ev.category,
    current_share: ev.current_share,
    previous_share: ev.previous_share,
    trend: ev.trend,
    magnitude: ev.magnitude,
    weekly_series: ev.weekly_series,
    phrase_hint: ev.phrase_hint,
    positions: sortedByValue,
    last_occurrence,
    srs_state,
    avoidable_count,
    avg_drill_value,
    avg_cp_loss,
    impact_score,
    drill_stats,
    priority_today,
    recommended_today,
  };
}

/**
 * Priority-today: l'ordinamento di OGGI per la rotazione giornaliera.
 *   - base = impact_score (peso strutturale del freno)
 *   - boost +0.5 se ultima drill aveva wrong > 0 (riprenderlo presto)
 *   - boost +0.3 se non allenato da > 5 giorni e non mastered (decay memoria)
 *   - boost +0.2 se mai allenato (first_drill esperienza)
 *   - penalty -0.8 se gia` allenato oggi (skip)
 *   - penalty -0.4 se mastered (riprendere meno spesso)
 */
function computePriorityToday(
  impact: number,
  stats: PatternDrillStats,
  srs: PatternSrsState,
): number {
  let p = impact;
  if (stats.done_today) p -= 0.8;
  if (srs === "mastered") p -= 0.4;
  if (stats.total_runs === 0) p += 0.2;
  if (stats.last_run_at != null) {
    const days = (Date.now() - stats.last_run_at) / 86_400_000;
    if (days > 5 && srs !== "mastered") p += 0.3;
  }
  // Boost se ultima run aveva errors significativi (proxy: wrong > perfect)
  if (stats.wrong > stats.perfect && stats.total_positions > 0) p += 0.5;
  return p;
}

/** Drill value di una posizione: differenza p_target − p_mine sulla mossa giusta. */
export function drillValueOf(p: PositionRow): number {
  if (typeof p.drill_value === "number") return p.drill_value;
  const mine = p.p_mine_plays_best_sf ?? null;
  const target = p.p_target_plays_best_sf ?? null;
  if (mine != null && target != null) return Math.max(0, target - mine);
  return 0;
}

/** È evitabile al MIO livello? Soglie: drill_value alto OPPURE flag esplicito. */
export function isAvoidableAtMyLevel(p: PositionRow): boolean {
  if (typeof p.avoidable_at_my_level === "number" && p.avoidable_at_my_level === 1) return true;
  return drillValueOf(p) >= 0.2;
}

/** È irraggiungibile anche al livello target? */
export function isUnavoidableAtTarget(p: PositionRow): boolean {
  if (typeof p.unavoidable_at_target === "number" && p.unavoidable_at_target === 1) return true;
  const target = p.p_target_plays_best_sf ?? null;
  return target != null && target < 0.3;
}

/** Badge testuale sull'evitabilita`. Null se ambiguo. */
export type AvoidabilityLevel = "easy_for_me" | "growth_zone" | "hard_for_target" | "neutral";

export function avoidabilityOf(p: PositionRow): AvoidabilityLevel {
  const mine = p.p_mine_plays_best_sf ?? null;
  const target = p.p_target_plays_best_sf ?? null;
  if (mine != null && mine >= 0.55) return "easy_for_me";        // facile per me — l'ho mancata, sgomento
  if (target != null && target < 0.3) return "hard_for_target";  // anche il target fatica, meno colpa
  if (drillValueOf(p) >= 0.25) return "growth_zone";              // money: target lo trova, tu no
  return "neutral";
}

export function avoidabilityLabel(a: AvoidabilityLevel): string {
  return {
    easy_for_me: "Facile per il tuo livello — l'hai mancata",
    growth_zone: "Money drill — il target la trova, tu no (ancora)",
    hard_for_target: "Difficile anche per chi vuoi diventare",
    neutral: "",
  }[a];
}

export function avoidabilityColor(a: AvoidabilityLevel): string {
  return {
    easy_for_me: "#f43f5e",
    growth_zone: "#facc15",
    hard_for_target: "#94a3b8",
    neutral: "var(--color-text-soft)",
  }[a];
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Match strategy per categoria:
 * - tactic: motif === shortKey o flag motif_<shortKey> === 1
 * - phase_*: posizioni nella fase (opening/middlegame/endgame) con cp_loss alto
 * - time_overthinking: posizioni con spent_seconds > 30 e cp_loss >= 80
 * - time_instant_moves: posizioni con spent_seconds < 3 e cp_loss >= 80
 * - tilt_post_blunder: posizioni con cp_loss alto (proxy — manca sequence info)
 * - blow_winning: posizioni dove eri in vantaggio (cp_before alto) e l'hai
 *   ceduto (cp_after << cp_before)
 * - color_imbalance: posizioni nel colore con peggior performance — proxy:
 *   tutte le posizioni con cp_loss alto (filtro morbido, sara` raffinato)
 *
 * Ordinamento implicito: piu` pesanti (cp_loss) prima.
 */
function filterPositionsByPattern(
  positions: PositionRow[],
  fullKey: string,
  shortKey: string,
): PositionRow[] {
  // Tactical motifs — match by motif field or flag
  if (fullKey.startsWith("motif_")) {
    const flagKey = `motif_${shortKey}` as keyof PositionRow;
    return positions.filter((p) => {
      if (p.motif === shortKey) return true;
      const flag = p[flagKey];
      return typeof flag === "number" && flag === 1;
    });
  }

  // Phase-specific (phase_opening / phase_middlegame / phase_endgame)
  // NB: shortKey passato in input strippa solo "motif_". Per phase_* dobbiamo
  // estrarre noi: "phase_middlegame" → "middlegame".
  if (fullKey.startsWith("phase_")) {
    const phase = fullKey.replace(/^phase_/, "");
    return positions
      .filter((p) => p.phase === phase && p.cp_loss >= 50)
      .sort((a, b) => b.cp_loss - a.cp_loss);
  }

  // Timing — overthink / instant
  if (fullKey === "time_overthinking") {
    return positions
      .filter((p) => (p.spent_seconds ?? 0) > 30 && p.cp_loss >= 80)
      .sort((a, b) => b.cp_loss - a.cp_loss);
  }
  if (fullKey === "time_instant_moves") {
    return positions
      .filter((p) => (p.spent_seconds ?? 99) < 3 && p.cp_loss >= 80)
      .sort((a, b) => b.cp_loss - a.cp_loss);
  }

  // Tilt post-blunder: proxy = blunder critici. Manca info "post-blunder"
  // sequenziale, ma il pattern di "non recupera dopo errore" si esercita
  // riconquistando lucidita` sulle posizioni piu` pesanti.
  if (fullKey === "tilt_post_blunder") {
    return positions
      .filter((p) => p.cp_loss >= 150)
      .sort((a, b) => b.cp_loss - a.cp_loss)
      .slice(0, 10);
  }

  // Blow winning: eri sopra (cp_before > +100) e adesso non piu` (cp_after < 0)
  if (fullKey === "blow_winning") {
    return positions
      .filter((p) => (p.cp_before ?? 0) >= 100 && (p.cp_after ?? 0) <= 0)
      .sort((a, b) => b.cp_loss - a.cp_loss);
  }

  // Color imbalance: per ora le posizioni piu` pesanti (proxy debole). In
  // futuro filtreremo per il colore con worse win-rate del giocatore.
  if (fullKey === "color_imbalance") {
    return positions
      .filter((p) => p.cp_loss >= 100)
      .sort((a, b) => b.cp_loss - a.cp_loss)
      .slice(0, 10);
  }

  return [];
}

function deriveSrsState(
  ev: PatternEvolution,
  positions: PositionRow[],
  drillStats?: PatternDrillStats,
): PatternSrsState {
  // --- Override da drill memory: lo "guadagni" allenando ---
  if (drillStats) {
    const totalPos = drillStats.total_positions;
    const perfectRatio = totalPos > 0 ? drillStats.perfect / totalPos : 0;
    const wrongRatio = totalPos > 0 ? drillStats.wrong / totalPos : 0;
    const daysSinceLast = drillStats.last_run_at != null
      ? (Date.now() - drillStats.last_run_at) / 86_400_000
      : Infinity;

    // Mastered: 2+ run, >=70% perfette, ultima drill recente
    if (drillStats.total_runs >= 2 && perfectRatio >= 0.7 && daysSinceLast <= 7) {
      return "mastered";
    }
    // Decaying: allenato bene ma giorni passati — sta sbiadendo
    if (drillStats.total_runs >= 2 && perfectRatio >= 0.5 && daysSinceLast > 7) {
      return "decaying";
    }
    // Fresh forzato: hai sbagliato recentemente
    if (wrongRatio > 0.3 && daysSinceLast <= 3) {
      return "fresh";
    }
  }

  // --- Fallback: stato derivato dal trend backend ---
  if (positions.length === 0 && ev.current_share < 0.02) {
    return ev.previous_share < 0.02 ? "new" : "mastered";
  }
  if (ev.trend === "worsening") return "fresh";
  if (ev.current_share >= 0.15) return "fresh";
  if (ev.trend === "improving" && ev.magnitude === "strong") {
    return ev.current_share < 0.05 ? "mastered" : "decaying";
  }
  if (positions.length >= 3) return "decaying";
  return "decaying";
}

/** Sort key per la rotazione di OGGI: alta = piu` urgente. */
export function pickTodaysPatterns(patterns: Pattern[], limit = 3): Pattern[] {
  return patterns
    .filter((p) => p.positions.length > 0) // solo drillabili
    .slice()
    .sort((a, b) => b.priority_today - a.priority_today)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function categoryLabel(c: PatternCategory): string {
  return {
    tactic: "Tattica",
    timing: "Tempo",
    psych: "Mentale",
    decision: "Decisione",
    phase: "Fase",
    color: "Colore",
  }[c];
}

export function categoryColor(c: PatternCategory): string {
  // Coerente con il design system (CSS vars).
  return {
    tactic: "var(--color-brand-soft)",
    timing: "#facc15",
    psych: "#f43f5e",
    decision: "#34d399",
    phase: "#a78bfa",
    color: "#60a5fa",
  }[c];
}

export function trendArrow(t: PatternTrend): string {
  return { improving: "↘", stable: "→", worsening: "↗" }[t];
}

export function trendLabel(t: PatternTrend): string {
  return { improving: "migliorando", stable: "stabile", worsening: "peggiorando" }[t];
}

export function trendColor(t: PatternTrend): string {
  return { improving: "#34d399", stable: "#94a3b8", worsening: "#f43f5e" }[t];
}

export function srsLabel(s: PatternSrsState): string {
  return {
    fresh: "Da allenare",
    decaying: "Consolidare",
    mastered: "Dominato",
    new: "Non ancora osservato",
  }[s];
}

export function srsColor(s: PatternSrsState): string {
  return {
    fresh: "#f43f5e",
    decaying: "#facc15",
    mastered: "#34d399",
    new: "#94a3b8",
  }[s];
}

export function formatSharePct(share: number): string {
  const pct = share * 100;
  if (pct < 1) return "<1%";
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}
