// Tipi del player model v2 — sostituisce types v1.

export type Phase = "opening" | "middlegame" | "endgame";
export type Color = "white" | "black";
export type Result = "win" | "loss" | "draw";
export type MoveCategory = "ok" | "inaccuracy" | "mistake" | "blunder";
export type Confidence = "low" | "medium" | "high";

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
}

export interface Identity {
  username: string;
  goal: Goal;
  rating_by_time_class: Record<string, number>;
  last_game_date: string | null;
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
  /** Top-policy del mio livello (quanto "ovvia" e` la posizione per me) */
  p_maia_mine_top?: number | null;
  /** Top-policy del target (quanto "ovvia" e` per chi voglio diventare) */
  p_maia_target_top?: number | null;
  /** 1 - p_maia_target_top — quanto e` ambigua la posizione anche per il target */
  move_difficulty?: number | null;
  /** Differenza p_target_plays_best - p_mine_plays_best in [0,1]. Vero "drill money". */
  drill_value?: number | null;
  /** 3=money / 2=avoidable / 1=blunder critico raw / 0=skip */
  priority_score?: number;
  /** Tactical pattern detection (sprint 3 v2). Una posizione puo` averne piu` di uno. */
  motif_hanging_piece?: number;
  motif_fork?: number;
  motif_removed_defender?: number;
  motif_back_rank?: number;
  motif_discovered_attack?: number;
  /** Ultima mossa dell'avversario (per renderizzare la freccia di contesto a stile Chess.com/Lichess) */
  last_opp_from?: string | null;
  last_opp_to?: string | null;
  last_opp_san?: string | null;
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
}

// Output OpenAI gpt-5.4-mini in coach.py (opzionale, può non esistere)
export interface CoachBrief {
  headline: string;
  diagnosis_narrative: string;
  this_week: string[];
  avoid: string;
  generated_at: string;
  model: string;
}
