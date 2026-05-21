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
}

export interface TimeManagement {
  clock_vs_accuracy: ClockBucket[];
  instant_moves_in_critical: { n: number; avg_cp_loss: number; blunders: number };
  zeitnot: { n: number; avg_cp_loss: number; blunders: number };
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
  tilt: Tilt;
  blind_spots: BlindSpot[];
  turning_points: PositionRow[];
  drills: PositionRow[];
  diagnoses: Diagnosis[];
  weekly_focus: WeeklyFocus;
  coach_brief?: CoachBrief;
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
