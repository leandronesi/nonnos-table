export type Phase = "opening" | "middlegame" | "endgame";
export type Color = "white" | "black";
export type Result = "win" | "loss" | "draw";
export type MoveCategory = "ok" | "inaccuracy" | "mistake" | "blunder";
export type Motif =
  | "allowed_mate"
  | "material_loss"
  | "winning_to_lost"
  | "winning_advantage_thrown"
  | "positional_blunder";

export interface PhaseStats {
  moves: number;
  cp_loss_sum: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
  acpl?: number;
}

export interface GameRow {
  id: string;
  url: string | null;
  end_time_iso: string | null;
  end_time_epoch: number | null;
  month: string | null;
  date: string | null;
  time_class: string | null;
  rated: boolean | null;
  my_color: Color | null;
  my_rating: number | null;
  opp_rating: number | null;
  result: Result | null;
  eco: string | null;
  opening: string | null;
  num_moves: number | null;
  acpl: number | null;
  counts: { inaccuracy: number; mistake: number; blunder: number };
  by_phase: Record<Phase, PhaseStats>;
  blunder_move_numbers: number[];
  first_blunder_move: number | null;
  worst_move_loss: number;
  motif_counts: Record<string, number>;
}

export interface Kpi {
  games_analyzed: number;
  acpl_recent: number;
  acpl_previous: number;
  acpl_delta: number | null;
  rating_by_time_class: Record<string, number>;
  blunder_rate: number;
  total_blunders: number;
}

export interface MonthAgg {
  month: string;
  acpl: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  games: number;
  win_rate: number;
  wins: number;
  losses: number;
  draws: number;
  performance: number | null;
}

export interface ColorAgg {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  acpl: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  performance: number | null;
}

export interface TimeClassAgg {
  time_class: string;
  games: number;
  acpl: number;
  blunders: number;
  win_rate: number;
  performance: number | null;
}

export interface OpeningAgg {
  eco: string;
  opening: string;
  my_color: Color | "?";
  games: number;
  acpl: number;
  win_rate: number;
  blunders: number;
  performance: number | null;
}

export interface HeatmapData {
  bins: string[];
  data: Array<{ bin: string; opening: number; middlegame: number; endgame: number }>;
}

export interface MotifAgg {
  motif: Motif | string;
  label_it: string;
  count: number;
}

export interface PerformanceAgg {
  overall: { lifetime: number | null; last_30: number | null };
  by_time_class: Record<string, {
    lifetime: number | null;
    last_20: number | null;
    current_rating: number | null;
    games: number;
  }>;
}

export interface RatingTrendPoint {
  epoch: number;
  date: string | null;
  rating: number | null;
  performance_rolling: number | null;
  result: Result | null;
  opp_rating: number | null;
  game_id: string;
}

export interface Goal {
  target: number;
  time_class: string;
  deadline: string;
  no_data?: boolean;
  current_rating?: number | null;
  start_rating?: number | null;
  points_gained_since_start?: number;
  points_needed?: number;
  days_left?: number;
  days_since_start?: number;
  rate_per_day_so_far?: number | null;
  rate_per_day_needed?: number | null;
  projection_at_deadline?: number | null;
  on_track?: boolean;
  performance_last_20?: number | null;
  performance_vs_rating_gap?: number | null;
}

export interface BlunderRow {
  game_id: string;
  url: string | null;
  date: string | null;
  end_time_epoch: number | null;
  time_class: string | null;
  my_color: Color | null;
  my_rating: number | null;
  opp_rating: number | null;
  result: Result | null;
  eco: string | null;
  opening: string | null;
  ply: number;
  move_number: number;
  san: string;
  phase: Phase;
  cp_before: number;
  cp_after: number;
  cp_loss: number;
  best_san: string | null;
  pv_san: string[];
  fen_before: string | null;
  motif: Motif | string | null;
  motif_label: string;
}

export interface WorstGameRow {
  id: string;
  url: string | null;
  date: string | null;
  end_time_epoch: number | null;
  time_class: string | null;
  my_color: Color | null;
  result: Result | null;
  opp_rating: number | null;
  my_rating: number | null;
  opening: string | null;
  eco: string | null;
  num_moves: number | null;
  acpl: number | null;
  counts: { inaccuracy: number; mistake: number; blunder: number };
  worst_move_loss: number;
  ugliness: number;
}

export interface Metrics {
  generated_at_epoch: number;
  username: string;
  games: GameRow[];
  aggregates: {
    kpi: Kpi;
    goal: Goal;
    performance: PerformanceAgg;
    rating_trend: Record<string, RatingTrendPoint[]>;
    motifs: MotifAgg[];
    by_month: MonthAgg[];
    by_phase: Record<Phase, PhaseStats>;
    by_color: Record<Color, ColorAgg>;
    by_time_class: TimeClassAgg[];
    by_opening: OpeningAgg[];
    move_heatmap: HeatmapData;
  };
  top: {
    blunders: BlunderRow[];
    worst_games: WorstGameRow[];
    daily_picks: BlunderRow[];
  };
  insights: string[];
}

// Per il drill-down su singola partita: dati di analisi completi caricati on-demand
export interface MoveAnalysis {
  ply: number;
  move_number: number;
  san: string;
  phase: Phase;
  cp_before: number;
  cp_after: number;
  cp_loss: number;
  category: MoveCategory;
  best_san: string | null;
  pv_san: string[];
  fen_before: string | null;
  motif: Motif | string | null;
}

export interface GameAnalysis {
  game_id: string;
  params_hash: string;
  profile: string;
  index: {
    id: string;
    url: string;
    end_time_iso: string;
    end_time_epoch: number;
    time_class: string;
    time_control: string | null;
    rated: boolean;
    my_color: Color;
    my_rating: number;
    opp_rating: number;
    result: Result;
    eco: string | null;
    opening: string | null;
    num_moves: number | null;
  };
  pgn: string;
  analysis: {
    moves: MoveAnalysis[];
    fens: string[];
    evals_my_pov: number[];
    summary: {
      my_color: Color;
      n_my_moves: number;
      acpl: number;
      by_phase: Record<Phase, PhaseStats>;
      counts: { inaccuracy: number; mistake: number; blunder: number };
      motif_counts: Record<string, number>;
      blunder_move_numbers: number[];
      first_blunder_move: number | null;
      worst_move_loss: number;
    };
  };
}
