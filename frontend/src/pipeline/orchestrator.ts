/**
 * Orchestratore della prima onboarding ingest.
 *
 * Sequenza completa per un nuovo utente:
 *   1. ingest    (Chess.com → Storage, indicizza `games`)
 *   2. analyze   (Stockfish browser-side, salva `analysis/*.json`)
 *   3. aggregate (combina in `quaderno/aggregates.json`)
 *   4. coach     (chiama Edge Function `coach-llm`, salva
 *                 `quaderno/coach_brief.json` + `coach_journal.md`)
 *   5. mark profile.onboarding_state='ready', ingest_jobs.status='done'
 *
 * Resumable: se l'utente chiude e riapre, l'orchestratore parte dallo stato
 * corrente di `ingest_jobs` + `games.analysis_status`.
 *
 * Idempotente: ogni step controlla cosa è già fatto, salta il resto.
 *
 * Solo UNA istanza in vita per tab via lock locale.
 */

import { supabase } from "../auth/supabaseClient";
import type { ProfileRow, IngestJobRow, OnboardingState } from "../auth/db.types";
import { runIngest } from "./ingest";
import { runAnalyze } from "./analyze";
import type { GameAnalysis } from "./analyze";
import { computeAggregates } from "./aggregate";
import { downloadJson, uploadJson, analysisPath, quadernoPath } from "../auth/storage";
import { buildPlayerModelLite } from "./playerModelLite";
import { appendSnapshot, buildSnapshot, readHistory } from "./history";
import type { Goal } from "../types";
import type { HistorySnapshot } from "../types";
import { FREE_GAME_CAP, FIRST_BATCH_SIZE } from "./config";

export interface OrchestratorProgress {
  phase: OnboardingState;
  monthsTotal: number;
  monthsDone: number;
  gamesTotal: number;
  gamesDone: number;
  message?: string;
}

let activeRun: Promise<void> | null = null;
// Listener di progresso "vivo": aggiornato a OGNI chiamata di
// runOnboardingOrchestrator. Se l'effect della waiting page rigira (StrictMode,
// re-mount, bounce Tavolo→home→waiting), il doRun in corso emette SEMPRE verso
// l'ultimo listener registrato, non verso una closure ormai cancellata. Era la
// causa del "Mi preparo…" congelato (doRun gira ma il progresso va nel vuoto)
// finché non si refreshava la pagina.
let currentOnProgress: ((p: OrchestratorProgress) => void) | null = null;
// Stessa disciplina "listener vivo" per le callback opzionali di lifecycle.
let currentOnFirstBatchReady: (() => void) | null = null;
let currentOnBackgroundDone: (() => void) | null = null;

export function resetActiveLock(): void {
  activeRun = null;
  currentOnProgress = null;
  currentOnFirstBatchReady = null;
  currentOnBackgroundDone = null;
}

export function runOnboardingOrchestrator(opts: {
  profile: ProfileRow;
  onProgress?: (p: OrchestratorProgress) => void;
  onFirstBatchReady?: () => void;
  onBackgroundDone?: () => void;
}): Promise<void> {
  // Aggiorna SEMPRE i listener vivi, anche se un run è già in corso.
  currentOnProgress = opts.onProgress ?? null;
  currentOnFirstBatchReady = opts.onFirstBatchReady ?? null;
  currentOnBackgroundDone = opts.onBackgroundDone ?? null;
  if (activeRun) return activeRun;
  activeRun = (async () => {
    try {
      await doRun(opts);
    } finally {
      activeRun = null;
    }
  })();
  return activeRun;
}

async function setProfileState(userId: string, state: OnboardingState, error?: string) {
  const patch: Partial<ProfileRow> = { onboarding_state: state };
  await supabase.from("profiles").update(patch).eq("user_id", userId);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[orchestrator] profile state →", state, error);
  }
}

async function currentJob(userId: string): Promise<IngestJobRow | null> {
  const { data } = await supabase
    .from("ingest_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as IngestJobRow | null) ?? null;
}

async function doRun(opts: {
  profile: ProfileRow;
  onProgress?: (p: OrchestratorProgress) => void;
  onFirstBatchReady?: () => void;
  onBackgroundDone?: () => void;
}) {
  const { profile } = opts;
  const userId = profile.user_id;

  let job = await currentJob(userId);
  if (!job) {
    // Nessun job: ne creo uno.
    const { data } = await supabase
      .from("ingest_jobs")
      .insert({
        user_id: userId,
        status: "queued",
        months_total: 0,
        months_done: 0,
        games_total: 0,
        games_done: 0,
      })
      .select("*")
      .single();
    job = data as IngestJobRow;
  }

  // Recovery: un job 'error' (es. coach fallito perché l'edge function non era
  // ancora deployata) deve poter ripartire al reload, invece di restare bloccato.
  // Ri-deriviamo lo stage dal progresso reale.
  if (job.status === "error") {
    const { count: gameCount } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((gameCount ?? 0) === 0) {
      await supabase
        .from("ingest_jobs")
        .update({ status: "queued", error: null })
        .eq("id", job.id);
    } else {
      // Risaliamo dallo stato di analisi delle partite (come nell'anti-loop guard).
      const { count: doneCount } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("analysis_status", "done");
      const done = doneCount ?? 0;
      const recoverTo: "analyzing_first" | "analyzing_rest" =
        done < FIRST_BATCH_SIZE ? "analyzing_first" : "analyzing_rest";
      await supabase
        .from("ingest_jobs")
        .update({ status: recoverTo, error: null })
        .eq("id", job.id);
    }
    job = (await currentJob(userId)) ?? job;
  }

  // Guard: job 'done' but profile NOT 'ready' — this is the primary loop trigger.
  // It happens when:
  //   a) runRefresh() creates a NEW queued job but the old 'done' job is still
  //      returned as the most recent (race), or
  //   b) a previous doRun run set the job to 'done' but failed to set the
  //      profile to 'ready' (e.g. DB update succeeded for job but not profile).
  // In both cases no `if (job.status === ...)` block below would match, doRun
  // would return silently, and the .then() in OnboardingWaiting would call
  // refreshProfile(), changing the profile object and re-triggering the effect
  // → infinite loop.
  //
  // Fix: if the job is 'done' but the profile is still pending, re-derive the
  // correct re-run stage from actual game data (same logic as error recovery).
  if (job.status === "done" && profile.onboarding_state !== "ready") {
    // Deriving the correct re-run stage from actual game data.
    // If there are un-analyzed games → derive first vs rest from done count;
    // otherwise → re-aggregate + coach (finale).
    const { count: pendingCount } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("analysis_status", "pending");
    let recoverTo: "analyzing_first" | "analyzing_rest" | "coaching";
    if ((pendingCount ?? 0) > 0) {
      const { count: doneCount } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("analysis_status", "done");
      recoverTo = (doneCount ?? 0) < FIRST_BATCH_SIZE ? "analyzing_first" : "analyzing_rest";
    } else {
      recoverTo = "coaching";
    }
    await supabase
      .from("ingest_jobs")
      .update({ status: recoverTo, finished_at: null, error: null })
      .eq("id", job.id);
    job = (await currentJob(userId)) ?? job;
  }

  const emit = (patch: Partial<OrchestratorProgress> & Pick<OrchestratorProgress, "phase">) =>
    currentOnProgress?.({
      monthsTotal: job?.months_total ?? 0,
      monthsDone: job?.months_done ?? 0,
      gamesTotal: job?.games_total ?? 0,
      gamesDone: job?.games_done ?? 0,
      ...patch,
    });

  // ---- Step 1: INGEST ----
  if (job.status === "queued" || job.status === "fetching") {
    await setProfileState(userId, "ingesting");
    emit({ phase: "ingesting", message: "Scarico le tue partite da Chess.com…" });
    try {
      await runIngest({
        userId,
        chessComUsername: profile.chess_com_username,
        jobId: job.id,
        refreshAfter: job.refresh_after ?? undefined,
        onProgress: (p) =>
          emit({
            phase: "ingesting",
            monthsTotal: p.monthsTotal,
            monthsDone: p.monthsDone,
            gamesTotal: p.gamesTotal,
            gamesDone: p.gamesDone,
          }),
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      await supabase
        .from("ingest_jobs")
        .update({ status: "error", error: msg })
        .eq("id", job.id);
      await setProfileState(userId, "error", msg);
      throw e;
    }
    await supabase.from("ingest_jobs").update({ status: "analyzing_first" }).eq("id", job.id);
    job = (await currentJob(userId)) ?? job;
  }

  // ---- Step 2a: ANALYZE FIRST BATCH (20 partite più recenti) ----
  if (job.status === "analyzing_first" || job.status === "fetching") {
    await setProfileState(userId, "analyzing");
    emit({ phase: "analyzing", message: "Analizzo le partite con Stockfish…" });
    try {
      await runAnalyze({
        userId,
        jobId: job.id,
        range: { offset: 0, limit: FIRST_BATCH_SIZE },
        onProgress: (done, total) =>
          emit({
            phase: "analyzing",
            gamesTotal: total,
            gamesDone: done,
            message: "Analizzo le partite con Stockfish…",
          }),
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      await supabase
        .from("ingest_jobs")
        .update({ status: "error", error: msg })
        .eq("id", job.id);
      await setProfileState(userId, "error", msg);
      throw e;
    }
    await supabase.from("ingest_jobs").update({ status: "coaching_first" }).eq("id", job.id);
    job = (await currentJob(userId)) ?? job;
  }

  // ---- Step 2b: AGGREGATE + COACH PARZIALE (sulle prime 20) ----
  if (job.status === "coaching_first") {
    await setProfileState(userId, "coaching");
    emit({ phase: "coaching", message: "Confronto col tuo livello (Maia)…" });
    try {
      await runAggregateAndCoach(userId, profile);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      await supabase
        .from("ingest_jobs")
        .update({ status: "error", error: msg })
        .eq("id", job.id);
      await setProfileState(userId, "error", msg);
      throw e;
    }

    // Il profilo diventa 'ready' QUI (dopo le prime 20): l'utente può entrare
    // al Tavolo mentre il background continua. Da questo momento in poi il
    // background NON toccherà più onboarding_state.
    await setProfileState(userId, "ready");
    currentOnFirstBatchReady?.();

    // Controlla se esistono partite da analizzare nella seconda fetta.
    const { count: pendingRestCount } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("analysis_status", "pending");

    // Quante partite totali ci sono nella quota (serve sapere se la quota supera FIRST_BATCH_SIZE).
    const { count: quotaCount } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const hasSecondBatch = (pendingRestCount ?? 0) > 0 && (quotaCount ?? 0) > FIRST_BATCH_SIZE;
    if (hasSecondBatch) {
      await supabase.from("ingest_jobs").update({ status: "analyzing_rest" }).eq("id", job.id);
      job = (await currentJob(userId)) ?? job;
    } else {
      // Quota <= FIRST_BATCH_SIZE o tutte già analizzate: il profilo è già ready,
      // non c'è secondo lotto — history snapshot + done senza chiamare onBackgroundDone
      // (non c'era nessun "resto" da annunciare).
      try {
        const currentRating = await deriveCurrentRating(userId, profile);
        const targetRating = profile.goal_rating ?? undefined;
        const aggregates = await computeAggregates(userId, currentRating, targetRating);
        const existingHistory = await readHistory(userId);
        const run_kind: HistorySnapshot["run_kind"] =
          existingHistory.snapshots.length > 0 ? "reanalyze" : "onboarding";
        // Use immutable start_rating from first snapshot (day-1 baseline).
        const startRating = deriveStartRating(existingHistory, currentRating);
        const pointsGained = (currentRating ?? 0) - (startRating ?? currentRating ?? 0);
        const goalForSnap: Goal = {
          target: profile.goal_rating,
          time_class: profile.goal_time_class,
          deadline: profile.goal_deadline ?? "",
          current_rating: currentRating,
          start_rating: startRating,
          points_gained_since_start: Math.max(0, pointsGained),
          points_needed: Math.max(0, profile.goal_rating - (currentRating ?? 0)),
          days_left: profile.goal_horizon_weeks * 7,
          days_since_start: 0,
          rate_per_day_so_far: null,
          rate_per_day_needed: null,
          projection_at_deadline: null,
          on_track: false,
        };
        const snap = buildSnapshot(aggregates, goalForSnap, run_kind);
        await appendSnapshot(userId, snap);
      } catch (histErr) {
        // eslint-disable-next-line no-console
        console.warn("[orchestrator] history snapshot fallito (best-effort, ignoro):", histErr);
      }
      await supabase
        .from("ingest_jobs")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", job.id);
      emit({ phase: "ready" });
      return; // tutto finito, niente secondo lotto
    }
  }

  // ---- Step 2c: ANALYZE REST (partite 21-100) ----
  // NOTA: NON chiamiamo setProfileState qui. Il profilo è già 'ready' dal
  // coaching_first. Toccarlo di nuovo (→ "analyzing") farebbe rimbalzare
  // HomeGate dall'utente che sta già navigando il Tavolo.
  if (job.status === "analyzing_rest") {
    emit({ phase: "analyzing", message: "Analizzo le partite con Stockfish…" });
    try {
      await runAnalyze({
        userId,
        jobId: job.id,
        range: { offset: FIRST_BATCH_SIZE, limit: FREE_GAME_CAP - FIRST_BATCH_SIZE },
        onProgress: (done, total) =>
          emit({
            phase: "analyzing",
            gamesTotal: total,
            gamesDone: done,
            message: "Analizzo le partite con Stockfish…",
          }),
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      await supabase
        .from("ingest_jobs")
        .update({ status: "error", error: msg })
        .eq("id", job.id);
      // BACKGROUND: il profilo e' gia' 'ready', NON riportarlo a 'error'
      // (sbatterebbe l'utente fuori dal Tavolo). Il job resta 'error': al
      // prossimo avvio l'error-recovery riprende da analyzing_rest.
      throw e;
    }
    await supabase.from("ingest_jobs").update({ status: "coaching" }).eq("id", job.id);
    job = (await currentJob(userId)) ?? job;
  }

  // ---- Step 3: AGGREGATE + COACH FINALE (tutte le done, max 100) ----
  // NOTA: NON chiamiamo setProfileState qui. Il profilo è già 'ready' dal
  // coaching_first. Questo step è puro background: aggiorna il coach_brief con
  // tutte le 100 partite e annuncia la fine via onBackgroundDone.
  if (job.status === "coaching") {
    emit({ phase: "coaching", message: "Confronto col tuo livello (Maia)…" });
    try {
      await runAggregateAndCoach(userId, profile);

      // ---- History snapshot (best-effort, non blocca mai ready) ----
      try {
        const currentRating = await deriveCurrentRating(userId, profile);
        const targetRating = profile.goal_rating ?? undefined;
        const aggregates = await computeAggregates(userId, currentRating, targetRating);

        const existingHistory = await readHistory(userId);
        let run_kind: HistorySnapshot["run_kind"];
        if (job.refresh_after != null) {
          run_kind = "refresh";
        } else if (existingHistory.snapshots.length > 0) {
          run_kind = "reanalyze";
        } else {
          run_kind = "onboarding";
        }

        // Use immutable start_rating from first snapshot (day-1 baseline).
        const startRating = deriveStartRating(existingHistory, currentRating);
        const pointsGained = (currentRating ?? 0) - (startRating ?? currentRating ?? 0);
        const goalForSnap: Goal = {
          target: profile.goal_rating,
          time_class: profile.goal_time_class,
          deadline: profile.goal_deadline ?? "",
          current_rating: currentRating,
          start_rating: startRating,
          points_gained_since_start: Math.max(0, pointsGained),
          points_needed: Math.max(0, profile.goal_rating - (currentRating ?? 0)),
          days_left: profile.goal_horizon_weeks * 7,
          days_since_start: 0,
          rate_per_day_so_far: null,
          rate_per_day_needed: null,
          projection_at_deadline: null,
          on_track: false,
        };

        const snap = buildSnapshot(aggregates, goalForSnap, run_kind);
        await appendSnapshot(userId, snap);
      } catch (histErr) {
        // eslint-disable-next-line no-console
        console.warn("[orchestrator] history snapshot fallito (best-effort, ignoro):", histErr);
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      await supabase
        .from("ingest_jobs")
        .update({ status: "error", error: msg })
        .eq("id", job.id);
      // BACKGROUND: il profilo e' gia' 'ready', NON riportarlo a 'error'
      // (sbatterebbe l'utente fuori dal Tavolo). Il job resta 'error': al
      // prossimo avvio l'error-recovery riprende e ritenta il coaching finale.
      throw e;
    }
    await supabase
      .from("ingest_jobs")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", job.id);
    emit({ phase: "ready" });
    currentOnBackgroundDone?.();
  }
}

/**
 * Blocco aggregate + coach riusabile (gira su tutte le partite 'done' correnti).
 * Chiamato due volte: parziale (su 20) e finale (su 100). NON imposta il profilo
 * 'ready' — quella responsabilità resta al coaching finale nel doRun.
 */
async function runAggregateAndCoach(
  userId: string,
  profile: ProfileRow
): Promise<void> {
  const currentRating = await deriveCurrentRating(userId, profile);
  const targetRating = profile.goal_rating ?? undefined;
  const aggregates = await computeAggregates(userId, currentRating, targetRating);

  // ---- PlayerModelLite (best-effort) ----
  try {
    const { data: doneGames } = await supabase
      .from("games")
      .select("*")
      .eq("user_id", userId)
      .eq("analysis_status", "done")
      .order("played_at", { ascending: false });

    const gameRows = doneGames ?? [];
    const analyses: GameAnalysis[] = [];
    for (const g of gameRows) {
      if (!g.analysis_path) continue;
      const ga = await downloadJson<GameAnalysis>(
        analysisPath(userId, g.chess_com_uuid)
      );
      if (ga) analyses.push(ga);
    }

    // FIX C: derive the immutable start_rating baseline from history (day-1 snapshot)
    // and pass it to buildPlayerModelLite so the GoalHero shows the same baseline
    // as the milestone and history code. Without this the goal inside playerModelLite
    // re-derived start_rating from the oldest game on every run, which could zero or
    // negate points_gained_since_start every time the game window changed.
    const existingHistoryForPm = await readHistory(userId);
    const startRatingForPm = deriveStartRating(existingHistoryForPm, currentRating);

    const pmLite = buildPlayerModelLite(gameRows, analyses, profile, startRatingForPm);
    await uploadJson(quadernoPath(userId, "player_model_lite.json"), pmLite);
  } catch (pmErr) {
    // eslint-disable-next-line no-console
    console.warn("[orchestrator] buildPlayerModelLite fallito (best-effort):", pmErr);
  }

  // Coach LLM = best-effort.
  try {
    await invokeCoachLlm(userId, profile, aggregates);
  } catch (coachErr) {
    // eslint-disable-next-line no-console
    console.warn("[orchestrator] coach-llm fallito (best-effort, apro il Tavolo lo stesso):", coachErr);
  }
}

/**
 * Returns the immutable start_rating baseline for goal tracking.
 *
 * Strategy:
 *   1. If history already has snapshots, use the oldest snapshot's goal.current
 *      as the baseline — it was the rating at the time of first onboarding and
 *      must never change, so progress is measured from day 1.
 *   2. If no snapshots exist yet (first ever run), use currentRating — it will
 *      become the baseline once persisted in the first snapshot.
 *
 * This prevents the start_rating from being reset to the current rating at every
 * run, which zeroed out the points_gained_since_start counter.
 */
function deriveStartRating(
  existingHistory: { snapshots: Array<{ captured_at: string; goal: { current: number | null } }> },
  currentRating: number | null,
): number | null {
  if (existingHistory.snapshots.length === 0) return currentRating;
  // Oldest snapshot = first ever run.
  const sorted = [...existingHistory.snapshots].sort((a, b) =>
    a.captured_at.localeCompare(b.captured_at),
  );
  return sorted[0].goal.current ?? currentRating;
}

/** Deriva il rating corrente dell'utente (goal time class, con fallback). */
async function deriveCurrentRating(userId: string, profile: ProfileRow): Promise<number | null> {
  const goalTc = profile.goal_time_class;
  const { data: ratingRows } = await supabase
    .from("games")
    .select("player_rating")
    .eq("user_id", userId)
    .eq("time_class", goalTc)
    .not("player_rating", "is", null)
    .order("played_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ratingRows?.player_rating != null) return ratingRows.player_rating as number;
  // Fallback: most recent rating across all time classes.
  const { data: fallbackRow } = await supabase
    .from("games")
    .select("player_rating")
    .eq("user_id", userId)
    .not("player_rating", "is", null)
    .order("played_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (fallbackRow?.player_rating as number | null | undefined) ?? null;
}

/**
 * Restituisce il played_at (ISO string) della partita più recente dell'utente,
 * o null se non ci sono partite. Usato da runRefresh e runSilentRefresh.
 */
export async function getLatestGamePlayedAt(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("games")
    .select("played_at")
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { played_at: string } | null)?.played_at ?? null;
}

/**
 * Refresh (loop di ritorno): l'utente torna dopo qualche giorno → nuovo job +
 * profilo 'pending'. La waiting page riusa runOnboardingOrchestrator: ingest
 * prende solo le partite nuove (delta da refresh_after), analyze le nuove,
 * aggregate, coach (nuova voce nel Quaderno via append lato edge function).
 */
export async function runRefresh(profile: ProfileRow): Promise<void> {
  resetActiveLock();
  const latest = await getLatestGamePlayedAt(profile.user_id);
  await supabase.from("ingest_jobs").insert({
    user_id: profile.user_id,
    status: "queued",
    months_total: 0,
    months_done: 0,
    games_total: 0,
    games_done: 0,
    refresh_after: latest,
  });
  await supabase
    .from("profiles")
    .update({ onboarding_state: "pending" })
    .eq("user_id", profile.user_id);
}

/**
 * Rianalisi pulita: l'utente vuole ricalcolare tutto da capo col codice di
 * analisi corrente (es. dopo un upgrade del motore/feature come la cattura
 * della mossa avversario). NON riscarica da Chess.com: resetta solo lo stato
 * di analisi delle partite già in DB a 'pending' e fa ripartire l'orchestratore
 * dallo step ANALYZE.
 *
 * Effetto: analyze ri-processa tutte le partite (ora 'pending') sovrascrivendo
 * i JSON di analisi con i dati nuovi → aggregate → player_model_lite → coach.
 */
export async function runFullReanalyze(profile: ProfileRow): Promise<void> {
  resetActiveLock();
  const userId = profile.user_id;
  // 1. Resetta lo stato di analisi di tutte le partite dell'utente.
  await supabase
    .from("games")
    .update({ analysis_status: "pending", analysis_path: null })
    .eq("user_id", userId);
  // 2. Nuovo job che parte direttamente da 'analyzing_first' (niente re-download).
  await supabase.from("ingest_jobs").insert({
    user_id: userId,
    status: "analyzing_first",
    months_total: 0,
    months_done: 0,
    games_total: 0,
    games_done: 0,
  });
  // 3. Profilo in 'analyzing' → HomeGate manda alla waiting page che riprende.
  await supabase
    .from("profiles")
    .update({ onboarding_state: "analyzing" })
    .eq("user_id", userId);
}

/**
 * Silent background refresh — runs while the user stays on the Tavolo.
 *
 * Contract:
 *   - ADDITIVE: does NOT touch profile.onboarding_state, does NOT create
 *     ingest_jobs rows, does NOT interact with the 20+80 state machine.
 *   - No-op if activeRun is already in progress (onboarding / Refresh / Reanalyze
 *     just started) — we skip silently so there is no double work.
 *   - No-op if there are no new games on Chess.com since the last analysed game.
 *   - Ingest delta → analyze new games → aggregate → player_model_lite → coach.
 *   - Re-uses the internal step functions already used by doRun.
 */
export interface SilentRefreshCallbacks {
  onProgress?: (msg: string) => void;
  onNewGames?: (count: number) => void;
  onDone?: () => void;
}

/**
 * Key used to throttle the silent-refresh check to once per day per user.
 * Exported so OnboardingRunContext can read/write it without duplicating the key.
 */
export function silentRefreshThrottleKey(userId: string): string {
  return `nt_newgames_check_${userId}`;
}

export async function runSilentRefresh(
  profile: ProfileRow,
  callbacks: SilentRefreshCallbacks = {},
): Promise<void> {
  const { onProgress, onNewGames, onDone } = callbacks;
  const userId = profile.user_id;

  // Guard: do not double-work if the main orchestrator is already running.
  if (activeRun) {
    onDone?.();
    return;
  }

  // Step 1: detect new games (same strategy as the old nudge check).
  const latestPlayedAt = await getLatestGamePlayedAt(userId);

  let hasNew = false;
  let newGameCount = 0;
  try {
    const archivesRes = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(profile.chess_com_username)}/games/archives`,
    );
    if (archivesRes.ok) {
      const archivesData = (await archivesRes.json()) as { archives?: string[] };
      const archives = archivesData.archives ?? [];
      if (archives.length > 0) {
        const lastArchiveUrl = archives[archives.length - 1];
        const gamesRes = await fetch(lastArchiveUrl);
        if (gamesRes.ok) {
          const gamesData = (await gamesRes.json()) as {
            games?: Array<{ end_time?: number }>;
          };
          const games = gamesData.games ?? [];
          const cutoff = latestPlayedAt ? new Date(latestPlayedAt).getTime() / 1000 : 0;
          newGameCount = games.filter((g) => (g.end_time ?? 0) > cutoff).length;
          hasNew = newGameCount > 0;
        }
      }
    }
  } catch (e) {
    // Network failure is not fatal — silent no-op.
    // eslint-disable-next-line no-console
    console.warn("[runSilentRefresh] Chess.com check failed:", e);
    onDone?.();
    return;
  }

  if (!hasNew) {
    onDone?.();
    return;
  }

  onNewGames?.(newGameCount);

  // Step 2: ingest delta only (games newer than latestPlayedAt).
  // We do NOT create a proper ingest_job row to avoid touching the state machine.
  // runIngest uses refresh_after to filter what to download.
  // We create a transient ephemeral job row (status "queued") that will be set
  // to "done" at the end of this function. The key invariant: profile stays "ready"
  // throughout — we NEVER call setProfileState or set profile.onboarding_state.
  //
  // Re-check guard: if activeRun appeared while we were fetching Chess.com, abort.
  if (activeRun) {
    onDone?.();
    return;
  }

  let ephemeralJobId: string | null = null;

  try {
    onProgress?.("Sto guardando le tue ultime partite...");

    // Create a silent ephemeral job row (status 'queued') for runIngest to update.
    const { data: jobData, error: jobErr } = await supabase
      .from("ingest_jobs")
      .insert({
        user_id: userId,
        status: "queued",
        months_total: 0,
        months_done: 0,
        games_total: 0,
        games_done: 0,
        refresh_after: latestPlayedAt,
      })
      .select("*")
      .single();

    if (jobErr || !jobData) {
      throw new Error(`[runSilentRefresh] ingest_jobs insert failed: ${jobErr?.message ?? "no data"}`);
    }

    ephemeralJobId = (jobData as { id: string }).id;

    // Ingest delta.
    await runIngest({
      userId,
      chessComUsername: profile.chess_com_username,
      jobId: ephemeralJobId,
      refreshAfter: latestPlayedAt ?? undefined,
      onProgress: (p) => {
        onProgress?.(`Scarico ${p.gamesDone}/${p.gamesTotal} partite...`);
      },
    });

    // Guard again: if main orchestrator started during ingest, abort cleanly.
    if (activeRun) {
      // Mark ephemeral job done so it does not confuse future orchestrator runs.
      await supabase
        .from("ingest_jobs")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", ephemeralJobId);
      onDone?.();
      return;
    }

    // Step 3: analyze new games only (those still 'pending' after ingest).
    onProgress?.("Analizzo con Stockfish...");
    await runAnalyze({
      userId,
      jobId: ephemeralJobId,
      // No range: analyze whatever is pending (only the newly ingested games).
      onProgress: (done, total) => {
        onProgress?.(`Analizzo ${done}/${total} partite...`);
      },
    });

    // Step 4: re-aggregate + player_model_lite + coach (full, on all done games).
    onProgress?.("Aggiorno il profilo...");
    await runAggregateAndCoach(userId, profile);

    // Mark ephemeral job done.
    const { error: doneErr } = await supabase
      .from("ingest_jobs")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", ephemeralJobId);
    if (doneErr) {
      // eslint-disable-next-line no-console
      console.warn("[runSilentRefresh] failed to mark job done:", doneErr.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[runSilentRefresh] error during background refresh:", e);
    // Best-effort: mark ephemeral job error so it does not block future runs.
    if (ephemeralJobId) {
      await supabase
        .from("ingest_jobs")
        .update({ status: "error", error: String(e instanceof Error ? e.message : e) })
        .eq("id", ephemeralJobId)
        .then(({ error: markErr }) => {
          if (markErr) {
            // eslint-disable-next-line no-console
            console.warn("[runSilentRefresh] failed to mark job error:", markErr.message);
          }
        });
    }
  } finally {
    onDone?.();
  }
}

async function invokeCoachLlm(
  _userId: string,
  profile: ProfileRow,
  _aggregates: unknown
): Promise<void> {
  // Chiamiamo l'Edge Function 'coach-llm'. Lei legge gli aggregati dal bucket
  // dell'utente (via service-role lato server) e scrive il coach_brief.json +
  // coach_journal.md su Storage. Qui passiamo solo profile context minimo.
  const { error } = await supabase.functions.invoke("coach-llm", {
    body: {
      goal_rating: profile.goal_rating,
      goal_time_class: profile.goal_time_class,
      goal_horizon_weeks: profile.goal_horizon_weeks,
      weekly_minutes: profile.weekly_minutes,
      chess_com_username: profile.chess_com_username,
    },
  });
  if (error) throw new Error(`coach-llm: ${error.message}`);
}
