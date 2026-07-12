/** Persistence contract for the intervention -> practice -> transfer loop. */

import { supabase } from "./auth/supabaseClient";
import type {
  AnchorMasteryRow,
  Json,
  TrainingAttemptRow,
  TrainingMode,
  TrainingVerdict,
} from "./auth/db.types";

export type TrainingAttemptInput = {
  anchorKey: string;
  sourceGameId?: string | null;
  positionId?: string | null;
  mode: TrainingMode;
  /** 1-based try number inside the current exercise. */
  attempts?: number;
  playedUci?: string | null;
  verdict?: TrainingVerdict | null;
  correct?: boolean | null;
  usedHint?: boolean;
  responseMs?: number | null;
  /** Raw normalized Maia policy mass on the accepted move set, not a frequency. */
  maiaCurrentAcceptableObservedPolicy?: number | null;
  /** Raw normalized Maia policy mass on the accepted move set, not a frequency. */
  maiaTargetAcceptableObservedPolicy?: number | null;
  context?: Record<string, Json>;
};

export type RecentTrainingAttempt = Pick<
  TrainingAttemptRow,
  | "id"
  | "anchor_key"
  | "source_game_id"
  | "position_id"
  | "mode"
  | "attempt_number"
  | "move_uci"
  | "verdict"
  | "correct"
  | "used_hint"
  | "response_ms"
  | "context"
  | "created_at"
>;

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("Authentication required");
  return userId;
}

function isAnchorMasteryRow(value: unknown): value is AnchorMasteryRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.user_id === "string"
    && typeof row.anchor_key === "string"
    && typeof row.status === "string"
    && typeof row.training_attempts === "number"
    && typeof row.training_successes === "number"
    && typeof row.game_opportunities === "number"
    && typeof row.transfer_successes === "number"
    && typeof row.mastery_score === "number";
}

export async function recordTrainingAttempt(input: TrainingAttemptInput): Promise<TrainingAttemptRow> {
  const userId = await requireUserId();
  const { data, error } = await supabase.from("training_attempts").insert({
    user_id: userId,
    anchor_key: input.anchorKey.slice(0, 160),
    source_game_id: input.sourceGameId?.slice(0, 160) ?? null,
    position_id: input.positionId?.slice(0, 240) ?? null,
    mode: input.mode,
    attempt_number: input.attempts ?? 1,
    move_uci: input.playedUci ?? null,
    verdict: input.verdict ?? null,
    correct: input.correct ?? null,
    used_hint: input.usedHint ?? false,
    response_ms: input.responseMs ?? null,
    maia_current_acceptable_observed_policy: input.maiaCurrentAcceptableObservedPolicy ?? null,
    maia_target_acceptable_observed_policy: input.maiaTargetAcceptableObservedPolicy ?? null,
    context: input.context ?? {},
    // The DB trigger replaces this client value with its own trusted timestamp.
    occurred_at: new Date().toISOString(),
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function recordAnchorTransfer(input: {
  anchorKey: string;
  observationKey: string;
  success: boolean;
  sourceGameId?: string | null;
  positionId?: string | null;
}): Promise<AnchorMasteryRow> {
  await requireUserId();
  const { data, error } = await supabase.rpc("record_anchor_transfer", {
    p_anchor_key: input.anchorKey.slice(0, 160),
    p_observation_key: input.observationKey.slice(0, 240),
    p_success: input.success,
    p_source_game_id: input.sourceGameId?.slice(0, 160) ?? null,
    p_position_id: input.positionId?.slice(0, 240) ?? null,
  });
  if (error) throw error;
  if (!isAnchorMasteryRow(data)) throw new Error("Invalid anchor mastery response");
  return data;
}

export async function loadAnchorMastery(): Promise<AnchorMasteryRow[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("anchor_mastery")
    .select("*")
    .eq("user_id", userId)
    .order("mastery_score", { ascending: true });
  if (error) throw error;
  return data;
}

/** Read-only history used to choose the next exercise without mutating mastery. */
export async function loadRecentTrainingAttempts(limit = 30): Promise<RecentTrainingAttempt[]> {
  const userId = await requireUserId();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 30));
  const { data, error } = await supabase
    .from("training_attempts")
    .select(
      "id,anchor_key,source_game_id,position_id,mode,attempt_number,move_uci,verdict,correct,used_hint,response_ms,context,created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return data;
}
