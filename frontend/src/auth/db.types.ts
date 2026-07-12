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
  | "analyzing_first"
  | "coaching_first"
  | "analyzing_rest"
  | "coaching"
  | "done"
  | "error";
export type IngestJobKind = "main" | "silent";

export type AnalysisStatus = "pending" | "analyzing" | "done" | "error";

export type TimeClass = "bullet" | "blitz" | "rapid" | "classical" | "daily";
export type GoalTimeClass = "blitz" | "rapid";
export type Color = "white" | "black";
export type Result = "win" | "loss" | "draw";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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

export type ProfileInsert = Omit<ProfileRow, "created_at" | "updated_at" | "onboarding_state" | "goal_deadline" | "goal_time_class"> & {
  goal_time_class: GoalTimeClass;
  onboarding_state?: OnboardingState;
  goal_deadline?: string | null;
};

export type ProfileUpdate = Omit<Partial<ProfileRow>, "goal_time_class"> & {
  goal_time_class?: GoalTimeClass;
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
  is_silent: boolean;
  kind: IngestJobKind;
  lease_token: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IngestJobInsert = Omit<
  IngestJobRow,
  "id" | "created_at" | "updated_at" | "started_at" | "finished_at" | "error" | "refresh_after" | "is_silent" | "kind" | "lease_token" | "lease_expires_at"
> & {
  started_at?: string | null;
  refresh_after?: string | null;
  is_silent?: boolean;
  kind?: IngestJobKind;
  lease_token?: string | null;
  lease_expires_at?: string | null;
};

export type IngestJobLeaseClaimRow = {
  job_id: string;
  claimed: boolean;
  lease_token: string | null;
  lease_expires_at: string | null;
  job_status: IngestJobStatus;
  job_kind: IngestJobKind;
};

export type AnalyticsEventRow = {
  id: string;
  user_id: string;
  anonymous_id: string | null;
  event_name: string;
  event_version: number;
  client_session_id: string | null;
  route: string | null;
  properties: Json;
  occurred_at: string;
  created_at: string;
};

export type AnalyticsEventInsert = Omit<AnalyticsEventRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type ClientErrorRow = {
  id: string;
  user_id: string;
  error_name: string | null;
  message: string;
  stack: string | null;
  severity: "warning" | "error" | "fatal";
  route: string | null;
  component: string | null;
  context: Json;
  occurred_at: string;
  created_at: string;
};

export type ClientErrorInsert = Omit<ClientErrorRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type FeedbackKind = "diagnosis" | "lesson" | "product" | "bug" | "other";

export type UserFeedbackRow = {
  id: string;
  user_id: string;
  kind: FeedbackKind;
  rating: number | null;
  subject: string | null;
  message: string | null;
  context: Json;
  created_at: string;
  updated_at: string;
};

export type UserFeedbackInsert = Omit<UserFeedbackRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type TrainingMode = "watch" | "guided" | "drill" | "review" | "game_transfer";
export type TrainingVerdict = "perfect" | "ok" | "wrong" | "skipped";

export type TrainingAttemptRow = {
  id: string;
  user_id: string;
  anchor_key: string;
  source_game_id: string | null;
  position_id: string | null;
  mode: TrainingMode;
  attempt_number: number;
  move_uci: string | null;
  verdict: TrainingVerdict | null;
  correct: boolean | null;
  used_hint: boolean;
  response_ms: number | null;
  maia_current_acceptable_observed_policy: number | null;
  maia_target_acceptable_observed_policy: number | null;
  context: Json;
  occurred_at: string;
  created_at: string;
};

export type TrainingAttemptInsert = Omit<TrainingAttemptRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type AnchorMasteryStatus = "candidate" | "practicing" | "review" | "mastered";

export type AnchorMasteryRow = {
  user_id: string;
  anchor_key: string;
  status: AnchorMasteryStatus;
  training_attempts: number;
  training_successes: number;
  game_opportunities: number;
  transfer_successes: number;
  mastery_score: number;
  last_practiced_at: string | null;
  last_observed_at: string | null;
  next_review_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AnchorMasteryInsert = Omit<AnchorMasteryRow, "created_at" | "updated_at"> & {
  created_at?: string;
  updated_at?: string;
};

export type AnchorTransferObservationRow = {
  id: string;
  user_id: string;
  anchor_key: string;
  observation_key: string;
  source_game_id: string | null;
  position_id: string | null;
  success: boolean;
  observed_at: string;
  created_at: string;
};

export type CorpusPruneBatchRow = {
  id: string;
  user_id: string;
  object_paths: string[];
  created_at: string;
};

export type AccountDeletionFenceRow = {
  user_id: string;
  requested_at: string;
};

// Schema per supabase-js generics.
// Forma richiesta da postgrest-js: ogni table ha Row/Insert/Update/Relationships.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
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
      analytics_events: {
        Row: AnalyticsEventRow;
        Insert: AnalyticsEventInsert;
        Update: Partial<AnalyticsEventRow>;
        Relationships: [];
      };
      client_errors: {
        Row: ClientErrorRow;
        Insert: ClientErrorInsert;
        Update: Partial<ClientErrorRow>;
        Relationships: [];
      };
      user_feedback: {
        Row: UserFeedbackRow;
        Insert: UserFeedbackInsert;
        Update: Partial<UserFeedbackRow>;
        Relationships: [];
      };
      training_attempts: {
        Row: TrainingAttemptRow;
        Insert: TrainingAttemptInsert;
        Update: Partial<TrainingAttemptRow>;
        Relationships: [];
      };
      anchor_mastery: {
        Row: AnchorMasteryRow;
        Insert: AnchorMasteryInsert;
        Update: Partial<AnchorMasteryRow>;
        Relationships: [];
      };
      anchor_transfer_observations: {
        Row: AnchorTransferObservationRow;
        Insert: AnchorTransferObservationRow;
        Update: Partial<AnchorTransferObservationRow>;
        Relationships: [];
      };
      corpus_prune_batches: {
        Row: CorpusPruneBatchRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      account_deletion_fences: {
        Row: AccountDeletionFenceRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      claim_ingest_job_lease: {
        Args: {
          p_job_id: string;
          p_lease_seconds?: number;
          p_allow_terminal?: boolean;
        };
        Returns: IngestJobLeaseClaimRow[];
      };
      complete_ingest_job_lease: {
        Args: {
          p_job_id: string;
          p_lease_token: string;
          p_status: "done" | "error";
          p_error?: string | null;
        };
        Returns: boolean;
      };
      patch_ingest_job_lease: {
        Args: {
          p_job_id: string;
          p_lease_token: string;
          p_patch: Json;
        };
        Returns: boolean;
      };
      ensure_analysis_job: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      is_valid_invite_code: {
        Args: { p_code: string };
        Returns: boolean;
      };
      record_anchor_transfer: {
        Args: {
          p_anchor_key: string;
          p_observation_key: string;
          p_success: boolean;
          p_source_game_id?: string | null;
          p_position_id?: string | null;
        };
        Returns: AnchorMasteryRow;
      };
      record_authenticated_analytics_event: {
        Args: {
          p_event_name: string;
          p_anonymous_id: string | null;
          p_client_session_id: string | null;
          p_route: string | null;
          p_properties: Json;
        };
        Returns: boolean;
      };
      reap_expired_ingest_leases: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      recover_legacy_goal_time_class: {
        Args: { p_goal_time_class: GoalTimeClass };
        Returns: boolean;
      };
      start_analysis_refresh: {
        Args: {
          p_goal_time_class: GoalTimeClass;
          p_refresh_after?: string | null;
        };
        Returns: string;
      };
      start_full_reanalysis: {
        Args: { p_goal_time_class: GoalTimeClass };
        Returns: string;
      };
      start_silent_refresh: {
        Args: {
          p_goal_time_class: GoalTimeClass;
          p_refresh_after?: string | null;
        };
        Returns: string;
      };
      release_ingest_job_lease: {
        Args: { p_job_id: string; p_lease_token: string };
        Returns: boolean;
      };
      renew_ingest_job_lease: {
        Args: {
          p_job_id: string;
          p_lease_token: string;
          p_lease_seconds?: number;
        };
        Returns: string | null;
      };
      stage_corpus_prune: {
        Args: {
          p_goal_time_class: GoalTimeClass;
          p_keep?: number;
        };
        Returns: string | null;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
