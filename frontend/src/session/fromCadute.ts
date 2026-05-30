/**
 * fromCadute.ts — Converter da PositionExample (aggregates.cadute) a PlayerModel minimale.
 *
 * Strategia: costruisce un mini-PlayerModel che soddisfi esattamente i campi
 * che GuidedSession + step leggono, senza riempire l'intero PlayerModel.
 *
 * Campi di PlayerModel usati da GuidedSession:
 *   pm.drills                        → posizioni per tema/warmup/drill
 *   pm.turning_points                → posizione per play step
 *   pm.identity.goal.target          → maiaLevel (stockfish skill)
 *   pm.identity.goal.current_rating  → sub-testo partita
 *   pm.identity.goal.time_class      → etichetta tempo
 *   pm.diagnoses?.[0]?.title         → fallback label pattern (opzionale)
 *   pm.weekly_focus?.headline        → fallback intro/label pattern (opzionale)
 *   pm.coach_session                 → frasi pre-generate Nonno (opzionale)
 *   pm.trend_weekly                  → card trend in RecapStep (opzionale)
 */

import type { PlayerModel, PositionRow, Identity, Goal, Kpi, Decisions, PhaseStat, ColorStat, Tilt, WeeklyFocus, Diagnosis } from "../types";
import type { PositionExample } from "../pipeline/aggregate";
import type { ProfileRow } from "../auth/db.types";
import { uciToSan } from "../pages/quaderno/boardArrows";

// ---------------------------------------------------------------------------
// Motif labels
// ---------------------------------------------------------------------------

const MOTIF_LABEL_IT: Record<string, string> = {
  pezzo_in_presa: "Pezzo in presa",
  fork: "Forchetta",
  pin: "Inchiodatura",
  skewer: "Infilata",
  back_rank: "Ultima traversa",
  discovered_attack: "Attacco scoperto",
  removed_defender: "Difensore rimosso",
  hanging_piece: "Pezzo appeso",
};

function motifLabelIt(motif: string | null | undefined): string | null {
  if (!motif) return null;
  return MOTIF_LABEL_IT[motif] ?? motif;
}

// ---------------------------------------------------------------------------
// toPositionRow
// ---------------------------------------------------------------------------

/**
 * Converte una PositionExample (caduta) in PositionRow compatibile con GuidedSession/step.
 *
 * Campi obbligatori di PositionRow che NON esistono in PositionExample
 * → ricevono valori di default sensati (null/0/"").
 *
 * I campi MAIA (p_mine_plays_best_sf, p_target_plays_best_sf, drill_value) sono null:
 * TemaStep li legge con guard (le linee MAIA vengono skippate se null/undefined).
 */
// PositionExample is extended at runtime by the Data block with these optional fields.
// TypeScript does not know about them, so we cast through unknown.
type PositionExampleExtended = PositionExample & {
  opening?: string | null;
  eco?: string | null;
  opp_rating?: number | null;
};

export function toPositionRow(pe: PositionExample, index: number): PositionRow {
  const pex = pe as PositionExampleExtended;
  // uciToSan returns the SAN string on success, the raw UCI on parse failure,
  // or "—" when uci is null/empty. We want:
  //   - the SAN if it is a real SAN (non-empty and different from the raw UCI),
  //   - otherwise the raw UCI (best_uci), so best_san_sf is never null when best_uci is valid.
  const rawSan = uciToSan(pe.fen_before, pe.best_uci ?? null);
  const rawUci = pe.best_uci ?? null;
  // rawSan === rawUci means uciToSan returned the UCI unchanged (conversion failed).
  // rawSan === "—" means best_uci was null/empty.
  const isTrueSan = rawSan && rawSan !== rawUci && rawSan !== "—";
  const bestSanSf = isTrueSan ? rawSan : (rawUci || null);

  return {
    // Campi da PositionExample
    fen_before: pe.fen_before,
    my_color: pe.color,
    phase: pe.phase as PositionRow["phase"],
    ply: pe.ply,
    san: pe.san,
    cp_loss: pe.cp_loss,
    motif: pe.motif ?? null,
    motif_label_it: motifLabelIt(pe.motif),
    move_difficulty: pe.move_difficulty ?? null,

    // Derivati
    best_san_sf: bestSanSf,
    cp_before: pe.cp_loss,   // non abbiamo cp_before preciso; usiamo cp_loss come proxy
    cp_after: 0,

    // game_id sintetico: stabile per posizione (fen hash leggero)
    game_id: `caduta_${index}`,
    move_number: Math.floor(pe.ply / 2) + 1,

    // Campi opzionali — null/default
    best_san_maia_mine: null,
    best_san_maia_target: null,
    url: null,
    date: pe.played_at ?? null,
    opp_rating: pex.opp_rating ?? null,
    result: null,
    opening: pex.opening ?? null,
    eco: pex.eco ?? null,
    pv_san_sf: null,

    // MAIA: propagati dalle cadute arricchite (null se Maia non ha girato).
    p_mine_plays_best_sf: pe.p_mine_plays_best_sf ?? null,
    p_target_plays_best_sf: pe.p_target_plays_best_sf ?? null,
    p_maia_mine_top: pe.p_maia_mine_top ?? null,
    p_maia_target_top: pe.p_maia_target_top ?? null,
    drill_value: pe.drill_value ?? null,
    avoidable_at_my_level: pe.avoidable === true ? 1 : undefined,
    unavoidable_at_target: undefined,
    priority_score: undefined,

    // Frecce avversario — propagate da PositionExample quando disponibili
    last_opp_from: pe.last_opp_from ?? null,
    last_opp_to: pe.last_opp_to ?? null,
    last_opp_san: pe.last_opp_san ?? null,

    // UCI raw: fallback per calcolare hintFrom quando best_san_sf non è SAN valido
    best_uci: pe.best_uci ?? null,

    // Contesto pre-blunder — non disponibile
    spent_seconds: pe.spent_seconds ?? null,
    prev_moves: null,
    waiting_moves: null,
  };
}

// ---------------------------------------------------------------------------
// buildMiniPlayerModel
// ---------------------------------------------------------------------------

/**
 * Costruisce un PlayerModel minimale che GuidedSession possa usare as-is,
 * partendo dalle cadute (PositionExample[]) e dal profilo Supabase.
 *
 * Riempiamo solo i campi che GuidedSession/step LEGGONO.
 * Tutto il resto riceve valori di default/vuoti per soddisfare il type.
 */
export function buildMiniPlayerModel(
  cadute: PositionExample[],
  profile: ProfileRow,
): PlayerModel {
  // Ordina per cp_loss desc (peggiori prima → più impatto nella sessione)
  const sorted = [...cadute].sort((a, b) => b.cp_loss - a.cp_loss);
  const drills = sorted.map((pe, i) => toPositionRow(pe, i));

  // Goal: prende i valori canonici dal profilo
  const target = profile.goal_rating;
  const timeClass = profile.goal_time_class;
  const deadline = profile.goal_deadline ?? "";

  const goal: Goal = {
    target,
    time_class: timeClass,
    deadline,
    current_rating: null,       // non lo abbiamo senza pmLite
    start_rating: null,
    points_gained_since_start: 0,
    points_needed: target,
    days_left: 0,
    days_since_start: 0,
    rate_per_day_so_far: null,
    rate_per_day_needed: null,
    projection_at_deadline: null,
    on_track: false,
  };

  const identity: Identity = {
    username: profile.chess_com_username,
    goal,
    rating_by_time_class: {},
    last_game_date: null,
  };

  // KPI vuoti (GuidedSession non li legge direttamente)
  const kpi: Kpi = {
    critical_positions: drills.length,
    avg_cp_loss_on_critical: drills.length > 0 ? drills.reduce((s, d) => s + d.cp_loss, 0) / drills.length : 0,
    blunders_critical: 0,
    avoidable_blunders: 0,
    agreement_maia_mine_pct: null,
    agreement_maia_target_pct: null,
    acpl_recent_30: null,
    acpl_previous_30: null,
    acpl_delta: null,
    games_analyzed: 0,
  };

  const decisions: Decisions = {
    games: 0,
    reached_winning: 0,
    converted_winning: 0,
    conversion_rate: null,
    blew_winning: 0,
    blow_rate: null,
    reached_losing: 0,
    saved_losing: 0,
    save_rate: null,
    confidence_conversion: "low",
    confidence_save: "low",
  };

  const byPhase: PhaseStat[] = [];

  const colorStat: ColorStat = {
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    win_rate: null,
    avg_acpl: 0,
    performance: null,
    confidence: "low",
  };

  const tilt: Tilt = {
    after_blunder_avg_cp_loss: 0,
    after_blunder_n: 0,
    baseline_avg_cp_loss: 0,
    baseline_n: 0,
    tilt_factor: 1,
  };

  // Pattern label sintetico per il tema: motif più frequente tra le cadute
  const motifCounts: Record<string, number> = {};
  for (const d of drills) {
    const k = d.motif_label_it || d.motif;
    if (k) motifCounts[k] = (motifCounts[k] ?? 0) + 1;
  }
  const topMotif = Object.entries(motifCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  const weeklyFocus: WeeklyFocus = {
    headline: topMotif ?? "I tuoi momenti chiave",
    actions: [],
    confidence: "low",
  };

  const diagnoses: Diagnosis[] = topMotif
    ? [{ key: "cadute", title: topMotif, evidence: "", trainable: "", lichess_theme: null, priority: 1, confidence: "low" }]
    : [];

  // turning_points = drills (stesse posizioni, GuidedSession usa turning_points
  // come fallback e per playFen. Con turning_points = [] il play step mostra
  // PhaseFallback "Nessuna posizione per la partita" — accettabile se non
  // abbiamo turning points separati. Per dare una posizione di partita, usiamo
  // le stesse drills come turning_points ma limitiamo a 2 per evitare replay.
  const turning_points = drills.slice(0, 2);

  return {
    generated_at_epoch: Date.now(),
    schema_version: 2,
    identity,
    kpi,
    decisions,
    by_phase: byPhase,
    by_color: { white: colorStat, black: { ...colorStat } },
    openings: [],
    time_management: {
      clock_vs_accuracy: [],
      spent_vs_accuracy: [],
      instant_moves_in_critical: { n: 0, avg_cp_loss: 0, blunders: 0 },
      zeitnot: { n: 0, avg_cp_loss: 0, blunders: 0 },
    },
    rating_curve: {},
    tilt,
    blind_spots: [],
    turning_points,
    drills,
    diagnoses,
    weekly_focus: weeklyFocus,
    // Opzionali — assenti: GuidedSession ha guard su questi (?.)
    coach_session: undefined,
    coach_brief: undefined,
    trend_weekly: undefined,
  };
}
