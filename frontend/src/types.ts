// Tipi del player model v2 — sostituisce types v1.

export type Phase = "opening" | "middlegame" | "endgame";
export type Color = "white" | "black";
export type Result = "win" | "loss" | "draw";
export type MoveCategory = "ok" | "inaccuracy" | "mistake" | "blunder";
export type Confidence = "low" | "medium" | "high";

export interface RecentProgressionWindow {
  start_rating: number | null;
  current_rating: number | null;
  delta: number | null;
  games: number;
  available: boolean;
}

export interface RecentProgression {
  last_10d: RecentProgressionWindow;
  last_30d: RecentProgressionWindow;
  last_90d: RecentProgressionWindow;
}

export interface Goal {
  target: number;
  time_class: string;
  deadline: string;
  current_rating: number | null;
  start_rating: number | null;
  points_gained_since_start: number;
  points_needed: number;
  days_left: number;
  days_since_start: number;
  rate_per_day_so_far: number | null;
  rate_per_day_needed: number | null;
  projection_at_deadline: number | null;
  on_track: boolean;
  /** R2-A8 — progressione su finestre brevi (10gg/30gg/90gg) */
  recent_progression?: RecentProgression;
}

export interface PlanSummary {
  plan_epoch: number;
  days_since_plan: number;
  games_before: number;
  games_after: number;
  rating_at_plan: number | null;
  rating_now: number | null;
  delta_since_plan: number | null;
}

export interface Identity {
  username: string;
  goal: Goal;
  rating_by_time_class: Record<string, number>;
  last_game_date: string | null;
  /** Data ISO YYYY-MM-DD in cui l'utente ha definito il piano (= onboarding). */
  plan_started_at?: string;
  /** Snapshot prima/dopo il plan_started_at: games_before/after + delta rating. */
  plan_summary?: PlanSummary | null;
}

export interface Kpi {
  critical_positions: number;
  avg_cp_loss_on_critical: number;
  blunders_critical: number;
  avoidable_blunders: number;
  agreement_maia_mine_pct: number | null;
  agreement_maia_target_pct: number | null;
  acpl_recent_30: number | null;
  acpl_previous_30: number | null;
  acpl_delta: number | null;
  games_analyzed: number;
}

export interface Decisions {
  games: number;
  reached_winning: number;
  converted_winning: number;
  conversion_rate: number | null;
  blew_winning: number;
  blow_rate: number | null;
  reached_losing: number;
  saved_losing: number;
  save_rate: number | null;
  confidence_conversion: Confidence;
  confidence_save: Confidence;
}

export interface PhaseStat {
  phase: Phase;
  positions: number;
  avg_cp_loss: number;
  blunders: number;
  avoidable_blunders: number;
  blunder_rate: number | null;
  confidence: Confidence;
}

export interface ColorStat {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
  avg_acpl: number;
  performance: number | null;
  confidence: Confidence;
}

export interface OpeningStat {
  eco: string;
  opening: string;
  my_color: Color;
  games: number;
  win_rate: number | null;
  avg_acpl: number;
  confidence: Confidence;
}

export interface ClockBucket {
  bucket: string;
  key: string;
  positions: number;
  avg_cp_loss: number;
  blunders: number;
  errors?: number;
  avoidable_errors?: number;
  avoidable_share?: number;
  avg_gap?: number;
}

export interface SpentBucket {
  bucket: string;
  key: string;
  positions: number;
  avg_cp_loss: number;
  blunders: number;
  errors: number;
  error_rate: number;
  avoidable_errors?: number;
  avoidable_share?: number;
  avg_gap?: number;
}

export interface TimeManagement {
  clock_vs_accuracy: ClockBucket[];
  spent_vs_accuracy: SpentBucket[];
  instant_moves_in_critical: { n: number; avg_cp_loss: number; blunders: number };
  zeitnot: { n: number; avg_cp_loss: number; blunders: number };
}

export interface RatingPoint {
  epoch: number;
  date: string | null;
  rating: number | null;
  perf_5: number | null;
  perf_20: number | null;
  opp_rating: number | null;
  result: Result | null;
  game_id: string;
}

export interface Tilt {
  after_blunder_avg_cp_loss: number;
  after_blunder_n: number;
  baseline_avg_cp_loss: number;
  baseline_n: number;
  tilt_factor: number;
}

export interface BlindSpot {
  motif: string;
  label_it: string;
  n: number;
  avoidable_count: number;
  avg_cp_loss: number;
  confidence: Confidence;
}

export interface GoalProjection {
  available: boolean;
  reason?: string;
  current_perf_20?: number;
  target?: number;
  slope_elo_per_day?: number;
  projected_at?: string | null;          // "YYYY-MM-DD"
  slack_days?: number | null;
  risk_pct?: number;
  verdict?: "on_track" | "in_ritardo" | "stagnante" | "regressione" | "raggiunto";
  projected_at_with_daily_session?: string;
  delta_with_daily_session_days?: number;
}

export interface WeeklyTrendBucket {
  n_games: number;
  wins: number;
  win_rate: number | null;
  n_critical: number;
  avg_cp_loss: number;
  n_blunders: number;
  blunder_rate: number | null;
}

export interface WeeklyTrend {
  last_7d: WeeklyTrendBucket;
  prev_7d: WeeklyTrendBucket;
  delta: {
    n_games: number;
    win_rate: number | null;
    avg_cp_loss: number;
    n_blunders: number;
    blunder_rate: number | null;
  };
}

export interface RepertoireOpening {
  eco: string;
  opening: string;
  games: number;
  wins: number;
  win_rate: number | null;
  avg_acpl: number;
  confidence: Confidence;
  positions: PositionRow[];
}

export interface TacticalBreakdown {
  key: string;          // es. "motif_fork"
  label_it: string;
  n: number;
  n_total: number;
  share_pct: number;
  avg_gap_pct: number;
  avg_cp_loss: number;
  confidence: Confidence;
}

// Posizione di interesse (turning point o drill)
export interface PositionRow {
  game_id: string;
  ply: number;
  move_number: number;
  san: string;
  best_san_sf: string | null;
  best_san_maia_mine: string | null;
  best_san_maia_target: string | null;
  cp_before: number;
  cp_after: number;
  cp_loss: number;
  phase: Phase;
  fen_before: string;
  motif: string | null;
  motif_label_it: string | null;
  url: string | null;
  date: string | null;
  my_color: Color;
  opp_rating: number | null;
  result: Result | null;
  opening: string | null;
  eco: string | null;
  pv_san_sf: string | null;
  avoidable_at_my_level?: number;
  unavoidable_at_target?: number;
  /** Probabilita` che Maia@mio livello giochi la mossa Stockfish-best in [0,1] */
  p_mine_plays_best_sf?: number | null;
  /** Probabilita` che Maia@target giochi la mossa Stockfish-best in [0,1] */
  p_target_plays_best_sf?: number | null;
  /** Top-policy del mio livello (quanto "ovvia" è la posizione per me) */
  p_maia_mine_top?: number | null;
  /** Top-policy del target (quanto "ovvia" è per chi voglio diventare) */
  p_maia_target_top?: number | null;
  /** 1 - p_maia_target_top — quanto è ambigua la posizione anche per il target */
  move_difficulty?: number | null;
  /** Differenza p_target_plays_best - p_mine_plays_best in [0,1]. Vero "drill money". */
  drill_value?: number | null;
  /** 3=money / 2=avoidable / 1=blunder critico raw / 0=skip */
  priority_score?: number;
  /** Tactical pattern detection (sprint 3 v2). Una posizione può averne più di uno. */
  motif_hanging_piece?: number;
  motif_fork?: number;
  motif_removed_defender?: number;
  motif_back_rank?: number;
  motif_discovered_attack?: number;
  /** Ultima mossa dell'avversario (per renderizzare la freccia di contesto a stile Chess.com/Lichess) */
  last_opp_from?: string | null;
  last_opp_to?: string | null;
  last_opp_san?: string | null;
  /** R1-A — Review fields. */
  /** Secondi che il giocatore ha pensato sulla mossa (da Chess.com PGN [%clk]). */
  spent_seconds?: number | null;
  /** 3-5 mosse SAN PRECEDENTI per contesto pre-blunder (cronologico). */
  prev_moves?: string[] | null;
  /** Alternative "di attesa" Stockfish-validate (cp_loss < 50, non forzanti) quando la mossa giusta è troppo difficile (p_maia_mine_top < 0.20). */
  waiting_moves?: { san: string; cp_loss: number }[] | null;
}

export interface Diagnosis {
  key: string;
  title: string;
  evidence: string;
  trainable: string;
  lichess_theme: string | null;
  priority: number;
  confidence: Confidence;
}

export interface WeeklyFocus {
  headline: string;
  evidence?: string;
  actions: string[];
  confidence: Confidence;
}

export interface PlayerModel {
  generated_at_epoch: number;
  schema_version: number;
  identity: Identity;
  kpi: Kpi;
  decisions: Decisions;
  by_phase: PhaseStat[];
  by_color: Record<Color, ColorStat>;
  openings: OpeningStat[];
  time_management: TimeManagement;
  rating_curve: Record<string, RatingPoint[]>;
  tilt: Tilt;
  blind_spots: BlindSpot[];
  tactical_breakdown?: TacticalBreakdown[];
  repertoire_black?: RepertoireOpening[];
  repertoire_white?: RepertoireOpening[];
  trend_weekly?: WeeklyTrend;
  goal_projection?: GoalProjection;
  turning_points: PositionRow[];
  drills: PositionRow[];
  diagnoses: Diagnosis[];
  weekly_focus: WeeklyFocus;
  coach_brief?: CoachBrief;
  coach_artifacts?: {
    story?: string;
    progress?: string;
    roadmap?: string;
  };
  coach_session?: CoachSession;
  growth_delta?: GrowthDelta;
  /** Strutture pedonali rilevate nel tuo mediogioco — B (strategia). */
  pawn_structures?: PawnStructure[];
}

export interface StructureOpeningRow {
  eco: string;
  opening: string;
  n_games: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
}

export interface StructureSamplePosition {
  game_id: string;
  ply: number;
  move_number: number;
  fen_before: string;
  cp_loss: number;
  cp_before?: number;
  cp_after?: number;
  san: string;
  best_san_sf: string | null;
  motif: string | null;
  motif_label_it: string | null;
  phase: Phase;
  my_color: Color;
  date: string | null;
  opp_rating: number | null;
  opening: string | null;
  eco: string | null;
  url: string | null;
  result: Result | null;
  last_opp_from: string | null;
  last_opp_to: string | null;
  last_opp_san: string | null;
  p_mine_plays_best_sf: number | null;
  p_target_plays_best_sf: number | null;
  drill_value: number | null;
  motif_hanging_piece?: number;
  motif_fork?: number;
  motif_removed_defender?: number;
  motif_back_rank?: number;
  motif_discovered_attack?: number;
}

export interface StructureGameRow {
  game_id: string;
  date: string | null;
  opp_rating: number | null;
  opening: string | null;
  eco: string | null;
  my_color: Color;
  result: Result | null;
  url: string | null;
  n_positions_in_struct: number;
  worst_cp_loss: number;
}

export interface PawnStructure {
  /** Chiave canonica (es. "iqp_white", "carlsbad", "french_chain"). */
  key: string;
  /** Etichetta italiana per UI. */
  label_it: string;
  /** Posizioni di mediogioco rilevate con questa struttura. */
  n_positions: number;
  /** Partite distinte che ci passano. */
  n_games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Win-rate delle partite (0..1) o null. */
  win_rate: number | null;
  /** Avg cp_loss dei tuoi errori in queste posizioni. */
  avg_cp_loss: number;
  /** Motif tattico dominante (label_it) quando sbagli qui. */
  dominant_motif: string | null;
  confidence: Confidence;
  /** Top ECO che ti portano in questa struttura. */
  openings_breakdown?: StructureOpeningRow[];
  /** Posizioni rappresentative (top per cp_loss, max 1 per partita per varietà). */
  sample_positions?: StructureSamplePosition[];
  /** Partite recenti che hanno toccato la struttura. */
  games_sample?: StructureGameRow[];
}

// Delta-pattern week-over-week — calcolato deterministico da backend/growth.py.
// Versione estesa (R1-A7): serie temporale multi-settimana per ogni pattern,
// + back-compat coi campi `summary_*` esistenti.

export interface PatternWeeklyPoint {
  week_iso: string;
  share: number;
  n: number;
}

export interface PatternEvolution {
  key: string;
  label_it: string;
  category: "tactic" | "timing" | "psych" | "decision" | "phase" | "color";
  current_share: number;
  previous_share: number;
  trend: "improving" | "worsening" | "stable";
  magnitude: "weak" | "medium" | "strong";
  weekly_series: PatternWeeklyPoint[];
  phrase_hint: string;
  // back-compat (vecchio formato GrowthDeltaPattern)
  share_curr?: number;
  share_prev?: number;
  delta_share?: number;
  direction?: string;
}

// Alias retro-compatibile (nessun chiamante usa più questo type ma lo mantengo)
export type GrowthDeltaPattern = PatternEvolution;

export interface GrowthDelta {
  available: boolean;
  reason?: string;
  as_of?: string;
  window_days?: number;
  compare_to_days?: number;
  patterns?: PatternEvolution[];
  // back-compat summary_*
  summary_key?: string;
  summary_label_it?: string;
  summary_direction?: string;
  summary_magnitude?: string;
  summary_phrase_hint?: string;
}

// Output OpenAI gpt-5.4-mini in coach.py (opzionale, può non esistere)
export interface CoachBrief {
  headline: string;
  diagnosis_narrative: string;
  this_week: string[];
  avoid: string;
  generated_at: string;
  model: string;
  pipeline_mode?: string;
  /** R1-B — apertura del Tavolo (home): 3-4 frasi che anticipano la sessione. */
  open_tavolo?: string;
}

// Frasi di Coach pre-generate per la sessione (warmup/bivio/play/recap).
// Generate da coach.py.generate_session_phrases() e iniettate in
// pm.coach_session.
export interface CoachSession {
  /** R1-B — apertura della home/Tavolo: 3-4 frasi che anticipano la sessione. */
  open_tavolo?: string;
  open_warmup: string;
  between_warmup_bivio: string;
  open_bivio: string;
  between_bivio_play: string;
  open_play: string;
  recap_win: string;
  recap_draw: string;
  recap_loss: string;
  close: string;
}
