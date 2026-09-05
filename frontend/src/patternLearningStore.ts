import { supabase } from "./auth/supabaseClient";
import { buildPatternLearning, type LearningAttempt, type PatternObservation } from "./pipeline/patternLearning";
import { recordAnchorTransfer } from "./trainingProgress";

/** Paged history: a busy learner's first intervention must not disappear behind a latest-30 limit. */
export async function loadPatternAttempts(userId: string): Promise<LearningAttempt[]> {
  const attempts: LearningAttempt[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("training_attempts")
      .select("id,anchor_key,source_game_id,position_id,mode,verdict,correct,used_hint,response_ms,created_at")
      .eq("user_id", userId).order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    attempts.push(...data);
    if (data.length < 500) return attempts;
  }
}

/** Server RPC deduplicates each pattern+position; prefetch avoids re-sending old observations. */
export async function syncPatternTransfers(userId: string, observations: PatternObservation[], guard: () => Promise<void>): Promise<void> {
  const attempts = await loadPatternAttempts(userId);
  const { transfers } = buildPatternLearning(observations, attempts);
  if (!transfers.length) return;
  const existing = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("anchor_transfer_observations")
      .select("anchor_key,observation_key").eq("user_id", userId)
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    data.forEach((row) => existing.add(`${row.anchor_key}|${row.observation_key}`));
    if (data.length < 500) break;
  }
  for (const candidate of transfers) {
    if (existing.has(`${candidate.anchorKey}|${candidate.observationKey}`)) continue;
    await guard();
    await recordAnchorTransfer({ ...candidate, expectedUserId: userId });
  }
}
