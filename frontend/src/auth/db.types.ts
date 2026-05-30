// Tipi DB Supabase per Nonno's Table.
// Manualmente allineati a supabase/migrations/0001_init.sql.
// (Quando vorrai puoi rigenerare con `supabase gen types typescript`.)
//
// NOTA: uso `type` invece di `interface` per i Row/Insert: TypeScript non
// considera le `interface` assegnabili a `Record<string, unknown>` (no
// index signature implicito), e supabase-js cade su `never` se la forma
// del Database non combacia con `GenericSchema`.

export type OnboardingState =
  | "pending"
  | "ingesting"
  | "analyzing"
  | "coaching"
  | "ready"
  | "error";

export type IngestJobStatus =
  | "queued"
  | "fetching"
  | "analyzing"
  | "coaching"
  | "done"
  | "error";

export type AnalysisStatus = "pending" | "analyzing" | "done" | "error";

export type TimeClass = "bullet" | "blitz" | "rapid" | "classical" | "daily";
export type Color = "white" | "black";
export type Result = "win" | "loss" | "draw";

export type ProfileRow = {
  user_id: string;
  chess_com_username: string;
  goal_rating: number;
  goal_horizon_weeks: number;
  goal_time_class: TimeClass;
  weekly_minutes: number;
  onboarding_state: OnboardingState;
  goal_deadline: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = Omit<ProfileRow, "created_at" | "updated_at" | "onboarding_state" | "goal_deadline"> & {
  onboarding_state?: OnboardingState;
  goal_deadline?: string | null;
};

export type GameRow = {
  id: string;
  user_id: string;
  chess_com_uuid: string;
  played_at: string;
  time_class: string;
  time_control: string | null;
  color: Color;
  result: Result;
  player_rating: number | null;
  opponent_rating: number | null;
  pgn_path: string;
  analysis_path: string | null;
  analysis_status: AnalysisStatus;
  error: string | null;
  created_at: string;
};

export type GameInsert = Omit<GameRow, "id" | "created_at" | "analysis_path" | "analysis_status" | "error"> & {
  analysis_status?: AnalysisStatus;
};

export type IngestJobRow = {
  id: string;
  user_id: string;
  status: IngestJobStatus;
  months_total: number;
  months_done: number;
  games_total: number;
  games_done: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  refresh_after: string | null;
  created_at: string;
  updated_at: string;
};

export type IngestJobInsert = Omit<
  IngestJobRow,
  "id" | "created_at" | "updated_at" | "started_at" | "finished_at" | "error" | "refresh_after"
> & {
  started_at?: string | null;
  refresh_after?: string | null;
};

// Schema per supabase-js generics.
// Forma richiesta da postgrest-js: ogni table ha Row/Insert/Update/Relationships.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      games: {
        Row: GameRow;
        Insert: GameInsert;
        Update: Partial<GameRow>;
        Relationships: [];
      };
      ingest_jobs: {
        Row: IngestJobRow;
        Insert: IngestJobInsert;
        Update: Partial<IngestJobRow>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_valid_invite_code: {
        Args: { p_code: string };
        Returns: boolean;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
