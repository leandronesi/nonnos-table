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

import { supabase, STORAGE_BUCKET } from "../auth/supabaseClient";
import type { ProfileRow, IngestJobRow, OnboardingState, Json } from "../auth/db.types";
import { runIngest } from "./ingest";
import { runAnalyze } from "./analyze";
import type { GameAnalysis } from "./analyze";
import { computeAggregates, type AnalysisActivity } from "./aggregate";
import { syncPatternTransfers } from "../patternLearningStore";
import { downloadJson, uploadJson, analysisPath, quadernoPath } from "../auth/storage";
import { buildPlayerModelLite } from "./playerModelLite";
import { appendSnapshot, buildSnapshot, readHistory } from "./history";
import type { Goal } from "../types";
import type { HistorySnapshot } from "../types";
import { getLang } from "../i18n/lang";
import {
  FREE_GAME_CAP,
  FIRST_BATCH_SIZE,
  goalAnalysisScope,
  shouldBuildRestCorpus,
} from "./config";
import type { AnalyzedTimeClass } from "./config";
import {
  buildAnalysisCoverage,
  canPublishFirstReading,
  countNewGoalGames,
  parsePartialAnalysis,
  requireExactCount,
  serializePartialAnalysis,
} from "./analysisRunSemantics";
import type { AnalysisCoverage } from "./analysisRunSemantics";
import {
  acquireOrObserveIngestJob,
  type IngestJobLease,
  LeaseOwnershipLostError,
} from "./jobLease";
import {
  observedLifecycleTransition,
  shouldNotifyObservedBackgroundDone,
} from "./jobLeaseSemantics";

export interface OrchestratorProgress {
  activity?: AnalysisActivity;
  observing?: boolean;
  phase: OnboardingState;
  monthsTotal: number;
  monthsDone: number;
  gamesTotal: number;
  gamesDone: number;
  /** JSON di analisi realmente caricati e marcati done; esclude i fallimenti. */
  gamesAnalyzed: number;
  /** False mentre gamesTotal e' ancora solo il cap di scansione, true a quota nota. */
  corpusFinalized?: boolean;
  /** Identifica il job per deduplicare le metriche terminali al reload. */
  analysisRunId?: string;
  /** Presente quando il corpus ha raggiunto uno stato terminale verificabile. */
  coverage?: AnalysisCoverage;
  message?: string;
}

let activeRun: Promise<void> | null = null;
let activeRunToken: object | null = null;
// Listener di progresso "vivo": aggiornato a OGNI chiamata di
// runOnboardingOrchestrator. Se l'effect della waiting page rigira (StrictMode,
// re-mount, bounce Tavolo→home→waiting), il doRun in corso emette SEMPRE verso
// l'ultimo listener registrato, non verso una closure ormai cancellata. Era la
// causa del "Mi preparo…" congelato (doRun gira ma il progresso va nel vuoto)
// finché non si refreshava la pagina.
let currentOnProgress: ((p: OrchestratorProgress) => void) | null = null;
// Stessa disciplina "listener vivo" per le callback opzionali di lifecycle.
let currentOnFirstBatchReady: (() => void) | null = null;
let currentOnBackgroundDone:
  | ((coverage: AnalysisCoverage, analysisRunId: string) => void)
  | null = null;

export function runOnboardingOrchestrator(opts: {
  profile: ProfileRow;
  onProgress?: (p: OrchestratorProgress) => void;
  onFirstBatchReady?: () => void;
  onBackgroundDone?: (coverage: AnalysisCoverage, analysisRunId: string) => void;
  /** Solo un'azione esplicita dell'utente riapre un job concluso parzialmente. */
  retryPartial?: boolean;
}): Promise<void> {
  // Aggiorna SEMPRE i listener vivi, anche se un run è già in corso.
  currentOnProgress = opts.onProgress ?? null;
  currentOnFirstBatchReady = opts.onFirstBatchReady ?? null;
  currentOnBackgroundDone = opts.onBackgroundDone ?? null;
  if (activeRun) return activeRun;
  const token = {};
  const run = (async () => {
    try {
      await doRun(opts);
    } finally {
      // Never let an older promise clear a newer run's lock.
      if (activeRunToken === token) {
        activeRun = null;
        activeRunToken = null;
      }
    }
  })();
  activeRun = run;
  activeRunToken = token;
  return run;
}

async function setProfileState(userId: string, state: OnboardingState, error?: string) {
  const { data: updatedProfile, error: updateError } = await supabase
    .from("profiles")
    .update({ onboarding_state: state })
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (updateError || !updatedProfile) {
    throw new Error(
      `profile_state_update_failed:${updateError?.message ?? "missing_row"}`,
    );
  }
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[orchestrator] profile state →", state, error);
  }
}

async function currentJob(userId: string): Promise<IngestJobRow | null> {
  const { data, error } = await supabase
    .from("ingest_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "main")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ingest_job_select_failed:${error.message}`);
  return (data as IngestJobRow | null) ?? null;
}

async function currentSilentJob(userId: string): Promise<IngestJobRow | null> {
  const { data, error } = await supabase
    .from("ingest_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "silent")
    .in("status", [
      "queued",
      "fetching",
      "analyzing",
      "analyzing_first",
      "coaching_first",
      "analyzing_rest",
      "coaching",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`silent_ingest_job_select_failed:${error.message}`);
  return (data as IngestJobRow | null) ?? null;
}

function emitObservedMainJob(
  job: IngestJobRow,
  profileState: OnboardingState,
  gamesAnalyzed: number,
  gamesTotal: number,
): void {
  const phase: OnboardingState = job.status === "done" && profileState === "ready"
    ? "ready"
    : job.status === "queued" || job.status === "fetching"
      ? "ingesting"
      : job.status === "coaching" || job.status === "coaching_first"
        ? "coaching"
        : job.status === "error"
          ? "error"
          : "analyzing";
  currentOnProgress?.({
    phase,
    monthsTotal: job.months_total,
    monthsDone: job.months_done,
    gamesTotal,
    gamesDone: job.games_done,
    gamesAnalyzed,
    observing: phase !== "ready",
    analysisRunId: job.id,
    corpusFinalized: !["queued", "fetching"].includes(job.status),
    message: phase === "ready"
      ? undefined
      : "Un'altra scheda sta completando questa analisi...",
  });
}

async function updateJobOrThrow(
  jobId: string,
  leaseToken: string,
  patch: Partial<IngestJobRow>,
  code: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("patch_ingest_job_lease", {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_patch: patch as unknown as Json,
  });
  if (error) throw new Error(`${code}:${error.message}`);
  if (data !== true) throw new LeaseOwnershipLostError();
}

function jobErrorMessage(cause: unknown): string {
  return String(cause instanceof Error ? cause.message : cause).slice(0, 4_000);
}

async function drainCorpusPruneBatches(
  guardLease?: () => Promise<void>,
): Promise<void> {
  const { data: batches, error } = await supabase
    .from("corpus_prune_batches")
    .select("id,object_paths")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(`corpus_prune_queue_select_failed:${error.message}`);

  for (const batch of batches ?? []) {
    for (let offset = 0; offset < batch.object_paths.length; offset += 100) {
      const paths = batch.object_paths.slice(offset, offset + 100);
      await guardLease?.();
      const { error: removeError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(paths);
      await guardLease?.();
      if (removeError) {
        throw new Error(`corpus_storage_prune_failed:${removeError.message}`);
      }
    }
    await guardLease?.();
    const { data: deleted, error: deleteError } = await supabase
      .from("corpus_prune_batches")
      .delete()
      .eq("id", batch.id)
      .select("id")
      .maybeSingle();
    await guardLease?.();
    if (deleteError || !deleted) {
      throw new Error(
        `corpus_prune_queue_delete_failed:${deleteError?.message ?? "missing_row"}`,
      );
    }
  }
}

async function enforceCorpusRetention(
  goalTimeClass: AnalyzedTimeClass,
  guardLease?: () => Promise<void>,
): Promise<void> {
  await drainCorpusPruneBatches(guardLease);
  // Each RPC stages/deletes at most 500 old rows. Bound work per foreground run;
  // any remaining backlog is picked up by the next refresh.
  for (let batch = 0; batch < 20; batch += 1) {
    await guardLease?.();
    const { data: batchId, error } = await supabase.rpc("stage_corpus_prune", {
      p_goal_time_class: goalTimeClass,
      p_keep: FREE_GAME_CAP,
    });
    await guardLease?.();
    if (error) throw new Error(`corpus_prune_stage_failed:${error.message}`);
    if (!batchId) return;
    await drainCorpusPruneBatches(guardLease);
  }
  // eslint-disable-next-line no-console
  console.warn("[orchestrator] corpus prune backlog deferred to the next run");
}

async function doRun(opts: {
  profile: ProfileRow;
  onProgress?: (p: OrchestratorProgress) => void;
  onFirstBatchReady?: () => void;
  onBackgroundDone?: (coverage: AnalysisCoverage, analysisRunId: string) => void;
  retryPartial?: boolean;
}) {
  const { profile } = opts;
  const userId = profile.user_id;
  const { timeClass: goalTimeClass } = goalAnalysisScope(profile.goal_time_class);

  try {
    await drainCorpusPruneBatches();
  } catch (pruneError) {
    // Durable queue remains available for the next run.
    // eslint-disable-next-line no-console
    console.warn("[orchestrator] deferred corpus storage cleanup:", pruneError);
  }

  let job = await currentJob(userId);
  if (!job) {
    // Cross-tab safe: Postgres serializza il check+insert e restituisce sempre
    // l'unico job principale più recente per l'utente autenticato.
    const { data: jobId, error: ensureError } = await supabase.rpc(
      "ensure_analysis_job",
      {},
    );
    if (ensureError || !jobId) {
      throw new Error(`ingest_job_ensure_failed:${ensureError?.message ?? "missing_job_id"}`);
    }
    job = await currentJob(userId);
    if (!job || job.id !== jobId) throw new Error("ingest_job_ensure_failed:missing_row");
  }

  let observerSawReady = profile.onboarding_state === "ready";
  let observedBackgroundWork = false;
  const acquisition = await acquireOrObserveIngestJob({
    jobId: job.id,
    userId,
    goalTimeClass,
    expectedKind: "main",
    allowTerminal: opts.retryPartial === true,
    onObserved: (observedJob, profileState, gamesAnalyzed, gamesTotal) => {
      emitObservedMainJob(observedJob, profileState, gamesAnalyzed, gamesTotal);
      const lifecycle = observedLifecycleTransition({
        readySeen: observerSawReady,
        profileReady: profileState === "ready",
        status: observedJob.status,
      });
      observerSawReady = lifecycle.readySeen;
      if (lifecycle.firstBatchBecameReady) {
        currentOnFirstBatchReady?.();
      }
      observedBackgroundWork ||= lifecycle.backgroundWork;
    },
  });
  if (acquisition.outcome === "terminal") {
    const coverage = parsePartialAnalysis(acquisition.job.error)
      ?? buildAnalysisCoverage(
        Math.max(acquisition.job.games_total, acquisition.gamesAnalyzed),
        acquisition.gamesAnalyzed,
      );
    currentOnProgress?.({
      phase: "ready",
      monthsTotal: acquisition.job.months_total,
      monthsDone: acquisition.job.months_done,
      gamesTotal: coverage.selected,
      gamesDone: coverage.selected,
      gamesAnalyzed: coverage.succeeded,
      corpusFinalized: true,
      analysisRunId: acquisition.job.id,
      coverage,
    });
    if (shouldNotifyObservedBackgroundDone({
      backgroundWorkSeen: observedBackgroundWork,
      profileWasReadyAtStart: profile.onboarding_state === "ready",
      selectedGames: coverage.selected,
      firstBatchSize: FIRST_BATCH_SIZE,
    })) {
      currentOnBackgroundDone?.(coverage, acquisition.job.id);
    }
    return;
  }
  const lease = acquisition.lease;
  try {
    await lease.guard();
    job = (await currentJob(userId)) ?? job;
    const { data: ownedProfileState, error: ownedProfileStateError } = await supabase
      .from("profiles")
      .select("onboarding_state")
      .eq("user_id", userId)
      .maybeSingle();
    if (ownedProfileStateError || !ownedProfileState) {
      throw new Error(
        `profile_observe_failed:${ownedProfileStateError?.message ?? "missing_profile"}`,
      );
    }
    const ownedLifecycle = observedLifecycleTransition({
      readySeen: observerSawReady,
      profileReady: ownedProfileState.onboarding_state === "ready",
      status: job.status,
    });
    observerSawReady = ownedLifecycle.readySeen;
    observedBackgroundWork ||= ownedLifecycle.backgroundWork;
    if (ownedLifecycle.firstBatchBecameReady) {
      currentOnFirstBatchReady?.();
    }

  // Le analisi fallite su singole partite sono una conclusione parziale, non
  // un errore infrastrutturale da ritentare a ogni apertura. I job prodotti
  // dalla vecchia versione (`background_analysis_incomplete`) vengono
  // normalizzati a `done` una volta; solo la CTA esplicita li riapre.
  const persistedPartial = parsePartialAnalysis(job.error);
  if (
    profile.onboarding_state === "ready" &&
    persistedPartial &&
    (job.status === "done" || job.status === "error")
  ) {
    if (opts.retryPartial) {
      await updateJobOrThrow(
        job.id,
        lease.token,
        {
          status: "analyzing_rest",
          error: null,
          finished_at: null,
        },
        "partial_retry_checkpoint_failed",
      );
    } else if (job.status === "error") {
      await updateJobOrThrow(
        job.id,
        lease.token,
        {
          games_total: persistedPartial.selected,
          games_done: persistedPartial.succeeded,
        },
        "partial_normalize_failed",
      );
      await lease.complete("done", serializePartialAnalysis(persistedPartial));
    }
    job = (await currentJob(userId)) ?? job;
  }

  // Recovery: un job 'error' (es. coach fallito perché l'edge function non era
  // ancora deployata) deve poter ripartire al reload, invece di restare bloccato.
  // Ri-deriviamo lo stage dal progresso reale.
  if (job.status === "error") {
    const { count: rawGameCount, error: gameCountError } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("time_class", goalTimeClass);
    const gameCount = requireExactCount(
      rawGameCount,
      gameCountError,
      "recovery_game_count_failed",
    );
    if (
      gameCount === 0 ||
      (profile.onboarding_state !== "ready" && gameCount < FIRST_BATCH_SIZE)
    ) {
      await updateJobOrThrow(
        job.id,
        lease.token,
        { status: "queued", error: null, finished_at: null },
        "recovery_queue_checkpoint_failed",
      );
    } else {
      // Risaliamo dallo stato di analisi delle partite (come nell'anti-loop guard).
      const { count: rawDoneCount, error: doneCountError } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("time_class", goalTimeClass)
        .eq("analysis_status", "done");
      const done = requireExactCount(
        rawDoneCount,
        doneCountError,
        "recovery_done_count_failed",
      );
      const recoverTo: "analyzing_first" | "coaching_first" | "analyzing_rest" =
        profile.onboarding_state === "ready"
          ? "analyzing_rest"
          : done < FIRST_BATCH_SIZE
            ? "analyzing_first"
            : "coaching_first";
      await updateJobOrThrow(
        job.id,
        lease.token,
        { status: recoverTo, error: null, finished_at: null },
        "recovery_stage_checkpoint_failed",
      );
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
    const { count: rawPendingCount, error: pendingCountError } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("time_class", goalTimeClass)
      .eq("analysis_status", "pending");
    const pendingCount = requireExactCount(
      rawPendingCount,
      pendingCountError,
      "resume_pending_count_failed",
    );
    let recoverTo: "analyzing_first" | "coaching_first";
    if (pendingCount > 0) {
      const { count: rawDoneCount, error: doneCountError } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("time_class", goalTimeClass)
        .eq("analysis_status", "done");
      const doneCount = requireExactCount(
        rawDoneCount,
        doneCountError,
        "resume_done_count_failed",
      );
      recoverTo = doneCount < FIRST_BATCH_SIZE
        ? "analyzing_first"
        : "coaching_first";
    } else {
      // Solo coaching_first rende il profilo ready; il coaching finale assume
      // invece che l'utente sia gia' entrato nel prodotto.
      recoverTo = "coaching_first";
    }
    await updateJobOrThrow(
      job.id,
      lease.token,
      { status: recoverTo, finished_at: null, error: null },
      "resume_stage_checkpoint_failed",
    );
    job = (await currentJob(userId)) ?? job;
  }

  const { data: persistedAnalysisRows, error: persistedAnalysisRowsError } = await supabase
    .from("games")
    .select("analysis_status,analysis_path")
    .eq("user_id", userId)
    .eq("time_class", goalTimeClass)
    .order("played_at", { ascending: false })
    .limit(FREE_GAME_CAP);
  if (persistedAnalysisRowsError) {
    throw new Error(`persisted_analysis_select_failed:${persistedAnalysisRowsError.message}`);
  }
  let gamesAnalyzed = (persistedAnalysisRows ?? []).filter(
    (row) => row.analysis_status === "done" && Boolean(row.analysis_path),
  ).length;

  const emit = (
    patch: Partial<OrchestratorProgress> & Pick<OrchestratorProgress, "phase">,
  ) => {
    if (patch.gamesAnalyzed !== undefined) gamesAnalyzed = patch.gamesAnalyzed;
    currentOnProgress?.({
      monthsTotal: job?.months_total ?? 0,
      monthsDone: job?.months_done ?? 0,
      gamesTotal: job?.games_total ?? 0,
      gamesDone: job?.games_done ?? 0,
      gamesAnalyzed,
      analysisRunId: job?.id,
      ...patch,
    });
  };

  // Un job parziale gia' concluso e' terminale al reload: mostriamo la
  // copertura persistita, ma non rilanciamo motori né il popup di fine lavoro.
  const terminalPartial = parsePartialAnalysis(job.error);
  if (
    job.status === "done" &&
    profile.onboarding_state === "ready" &&
    terminalPartial
  ) {
    emit({
      phase: "ready",
      gamesTotal: terminalPartial.selected,
      gamesDone: terminalPartial.selected,
      gamesAnalyzed: terminalPartial.succeeded,
      corpusFinalized: true,
      coverage: terminalPartial,
    });
    return;
  }

  // ---- Step 1: INGEST ----
  if (job.status === "queued" || job.status === "fetching") {
    await lease.guard();
    await setProfileState(userId, "ingesting");
    emit({
      phase: "ingesting",
      corpusFinalized: false,
      message: "Scarico le tue partite da Chess.com…",
    });
    try {
      await runIngest({
        userId,
        chessComUsername: profile.chess_com_username,
        goalTimeClass,
        gameCap: FIRST_BATCH_SIZE,
        requireAtLeastOne: job.refresh_after == null,
        jobId: job.id,
        leaseToken: lease.token,
        guardLease: () => lease.guard(),
        refreshAfter: job.refresh_after ?? undefined,
        onProgress: (p) =>
          emit({
            phase: "ingesting",
            monthsTotal: p.monthsTotal,
            monthsDone: p.monthsDone,
            gamesTotal: p.gamesTotal,
            gamesDone: p.gamesDone,
            corpusFinalized: false,
          }),
      });
    } catch (e) {
      const msg = jobErrorMessage(e);
      if (e instanceof LeaseOwnershipLostError) throw e;
      await lease.guard();
      await setProfileState(userId, "error", msg);
      await lease.complete("error", msg);
      throw e;
    }
    await updateJobOrThrow(
      job.id,
      lease.token,
      { status: "analyzing_first" },
      "analyzing_first_checkpoint_failed",
    );
    job = (await currentJob(userId)) ?? job;
  }

  // ---- Step 2a: ANALYZE FIRST BATCH (FIRST_BATCH_SIZE più recenti) ----
  if (job.status === "analyzing_first" || job.status === "fetching") {
    await lease.guard();
    await setProfileState(userId, "analyzing");
    emit({
      phase: "analyzing",
      corpusFinalized: true,
      message: "Analizzo le partite con Stockfish…",
    });
    try {
      const firstAnalysis = await runAnalyze({
        userId,
        jobId: job.id,
        leaseToken: lease.token,
        guardLease: () => lease.guard(),
        pulseLease: () => lease.pulse(),
        goalTimeClass,
        range: { offset: 0, limit: FIRST_BATCH_SIZE },
        onProgress: (progress) =>
          emit({
            phase: "analyzing",
            gamesTotal: progress.total,
            gamesDone: progress.processed,
            gamesAnalyzed: progress.succeeded,
            corpusFinalized: true,
            message: "Analizzo le partite con Stockfish…",
          }),
      });
      if (!canPublishFirstReading(firstAnalysis.sliceSucceeded)) {
        throw new Error("no_analyzable_games");
      }
    } catch (e) {
      const msg = jobErrorMessage(e);
      if (e instanceof LeaseOwnershipLostError) throw e;
      await lease.guard();
      await setProfileState(userId, "error", msg);
      await lease.complete("error", msg);
      throw e;
    }
    await updateJobOrThrow(
      job.id,
      lease.token,
      { status: "coaching_first" },
      "coaching_first_checkpoint_failed",
    );
    job = (await currentJob(userId)) ?? job;
  }

  // ---- Step 2b: AGGREGATE + COACH PARZIALE (prima fetta) ----
  if (job.status === "coaching_first") {
    await lease.guard();
    await setProfileState(userId, "coaching");
    emit({
      phase: "coaching",
      corpusFinalized: true,
      message: "Confronto col tuo livello (Maia)…",
    });
    try {
      await lease.guard();
      await runAggregateAndCoach(userId, profile, () => lease.guard(), activity => emit({ phase: "coaching", corpusFinalized: true, activity }));
      await lease.guard();
    } catch (e) {
      const msg = jobErrorMessage(e);
      if (e instanceof LeaseOwnershipLostError) throw e;
      await lease.guard();
      await setProfileState(userId, "error", msg);
      await lease.complete("error", msg);
      throw e;
    }

    // Il profilo diventa 'ready' QUI (dopo la prima fetta): l'utente può entrare
    // al Tavolo mentre il background continua. Da questo momento in poi il
    // background NON toccherà più onboarding_state.
    await lease.guard();
    await setProfileState(userId, "ready");
    currentOnFirstBatchReady?.();

    // Un errore/pending (o un vecchio done senza path) richiede il secondo lotto.
    // Se il primo ingest ha riempito il cap 10, dobbiamo inoltre fare un
    // secondo passaggio per scoprire e indicizzare le eventuali partite 11-100.
    const { data: recentAnalysisRows, error: retryableError } = await supabase
      .from("games")
      .select("analysis_status,analysis_path")
      .eq("user_id", userId)
      .eq("time_class", goalTimeClass)
      .order("played_at", { ascending: false })
      .limit(FREE_GAME_CAP);
    if (retryableError) {
      throw new Error(`retryable_analysis_select_failed:${retryableError.message}`);
    }
    const retryableGames = (recentAnalysisRows ?? []).filter(
      (row) => row.analysis_status !== "done" || !row.analysis_path,
    ).length;

    const hasSecondBatch = shouldBuildRestCorpus(
      job.games_total,
      retryableGames,
    );
    if (hasSecondBatch) {
      await updateJobOrThrow(
        job.id,
        lease.token,
        { status: "analyzing_rest" },
        "analyzing_rest_checkpoint_failed",
      );
      job = (await currentJob(userId)) ?? job;
    } else {
      // Quota <= FIRST_BATCH_SIZE o tutte già analizzate: il profilo è già ready,
      // non c'è secondo lotto — history snapshot + done senza chiamare onBackgroundDone
      // (non c'era nessun "resto" da annunciare).
      try {
        const currentRating = await deriveCurrentRating(userId, profile);
        const targetRating = profile.goal_rating ?? undefined;
        const aggregates = await computeAggregates(
          userId,
          goalTimeClass,
          currentRating,
          targetRating,
          () => lease.guard(),
          activity => emit({ phase: "coaching", corpusFinalized: true, activity }),
        );
        const existingHistory = await readHistory(userId);
        const run_kind: HistorySnapshot["run_kind"] =
          job.refresh_after != null
            ? "refresh"
            : existingHistory.snapshots.length > 0
              ? "reanalyze"
              : "onboarding";
        // Use immutable start_rating from first snapshot (day-1 baseline).
        const startRating = deriveStartRating(
          existingHistory,
          currentRating,
          goalTimeClass,
        );
        const pointsGained = (currentRating ?? 0) - (startRating ?? currentRating ?? 0);
        const goalForSnap: Goal = {
          target: profile.goal_rating,
          time_class: profile.goal_time_class,
          deadline: profile.goal_deadline ?? "",
          current_rating: currentRating,
          start_rating: startRating,
          points_gained_since_start: pointsGained,
          points_needed: Math.max(0, profile.goal_rating - (currentRating ?? 0)),
          days_left: profile.goal_horizon_weeks * 7,
          days_since_start: 0,
          rate_per_day_so_far: null,
          rate_per_day_needed: null,
          projection_at_deadline: null,
          on_track: false,
        };
        const snap = buildSnapshot(aggregates, goalForSnap, run_kind);
        await lease.guard();
        await appendSnapshot(userId, snap);
        await lease.guard();
      } catch (histErr) {
        if (histErr instanceof LeaseOwnershipLostError) throw histErr;
        // eslint-disable-next-line no-console
        console.warn("[orchestrator] history snapshot fallito (best-effort, ignoro):", histErr);
      }
      try {
        await enforceCorpusRetention(goalTimeClass, () => lease.guard());
      } catch (pruneError) {
        if (pruneError instanceof LeaseOwnershipLostError) throw pruneError;
        // Rows already staged have durable object paths and will be retried.
        // eslint-disable-next-line no-console
        console.warn("[orchestrator] corpus retention deferred:", pruneError);
      }
      await lease.complete("done", null);
      emit({ phase: "ready", corpusFinalized: true });
      return; // tutto finito, niente secondo lotto
    }
  }

  // ---- Step 2c: ANALYZE REST (dopo FIRST_BATCH_SIZE, fino al cap) ----
  // NOTA: NON chiamiamo setProfileState qui. Il profilo è già 'ready' dal
  // coaching_first. Toccarlo di nuovo (→ "analyzing") farebbe rimbalzare
  // HomeGate dall'utente che sta già navigando il Tavolo.
  if (job.status === "analyzing_rest") {
    emit({
      phase: "analyzing",
      corpusFinalized: false,
      message: "Completo il campione delle tue partite…",
    });
    try {
      // Secondo ingest idempotente: le prime 10 gia' presenti contano verso il
      // cap, poi indicizziamo 11-100. Manteniamo analyzing_rest come checkpoint:
      // se il tab si chiude, il reload ripete questo passaggio in sicurezza.
      await runIngest({
        userId,
        chessComUsername: profile.chess_com_username,
        goalTimeClass,
        gameCap: FREE_GAME_CAP,
        markJobFetching: false,
        jobId: job.id,
        leaseToken: lease.token,
        guardLease: () => lease.guard(),
        refreshAfter: job.refresh_after ?? undefined,
        onProgress: (p) =>
          emit({
            phase: "analyzing",
            monthsTotal: p.monthsTotal,
            monthsDone: p.monthsDone,
            gamesTotal: p.gamesTotal,
            gamesDone: p.gamesDone,
            corpusFinalized: false,
            message: "Completo il campione delle tue partite…",
          }),
      });
      job = (await currentJob(userId)) ?? job;

      emit({
        phase: "analyzing",
        corpusFinalized: true,
        message: "Analizzo le partite con Stockfish…",
      });
      const backgroundAnalysis = await runAnalyze({
        userId,
        jobId: job.id,
        leaseToken: lease.token,
        guardLease: () => lease.guard(),
        pulseLease: () => lease.pulse(),
        goalTimeClass,
        // I successi delle prime 10 vengono saltati; gli errori vengono ritentati.
        range: { offset: 0, limit: FREE_GAME_CAP },
        onProgress: (progress) =>
          emit({
            phase: "analyzing",
            gamesTotal: progress.total,
            gamesDone: progress.processed,
            gamesAnalyzed: progress.succeeded,
            corpusFinalized: true,
            message: "Analizzo le partite con Stockfish…",
          }),
      });
      const coverage = buildAnalysisCoverage(
        backgroundAnalysis.total,
        backgroundAnalysis.succeeded,
      );
      await updateJobOrThrow(
        job.id,
        lease.token,
        {
          status: "coaching",
          games_total: coverage.selected,
          games_done: coverage.succeeded,
          error: serializePartialAnalysis(coverage),
        },
        "analysis_checkpoint_failed",
      );
      job = (await currentJob(userId)) ?? job;
    } catch (e) {
      const msg = jobErrorMessage(e);
      if (e instanceof LeaseOwnershipLostError) throw e;
      await lease.complete("error", msg);
      // BACKGROUND: il profilo e' gia' 'ready', NON riportarlo a 'error'. Qui
      // arrivano solo guasti del run/checkpoint; i singoli PGN non leggibili
      // proseguono invece verso un coaching esplicitamente parziale.
      throw e;
    }
  }

  // ---- Step 3: AGGREGATE + COACH FINALE (tutte le done, max 100) ----
  // NOTA: NON chiamiamo setProfileState qui. Il profilo è già 'ready' dal
  // coaching_first. Questo step è puro background: aggiorna il coach_brief con
  // tutto il corpus disponibile (fino al cap) e annuncia la fine via onBackgroundDone.
  if (job.status === "coaching") {
    const completionCoverage =
      parsePartialAnalysis(job.error) ??
      buildAnalysisCoverage(
        Math.max(job.games_total, gamesAnalyzed),
        gamesAnalyzed,
      );
    emit({
      phase: "coaching",
      corpusFinalized: true,
      message: "Confronto col tuo livello (Maia)…",
    });
    try {
      await lease.guard();
      await runAggregateAndCoach(userId, profile, () => lease.guard(), activity => emit({ phase: "coaching", corpusFinalized: true, activity }));
      await lease.guard();

      // ---- History snapshot (best-effort, non blocca mai ready) ----
      try {
        const currentRating = await deriveCurrentRating(userId, profile);
        const targetRating = profile.goal_rating ?? undefined;
        const aggregates = await computeAggregates(
          userId,
          goalTimeClass,
          currentRating,
          targetRating,
          () => lease.guard(),
          activity => emit({ phase: "coaching", corpusFinalized: true, activity }),
        );

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
        const startRating = deriveStartRating(
          existingHistory,
          currentRating,
          goalTimeClass,
        );
        const pointsGained = (currentRating ?? 0) - (startRating ?? currentRating ?? 0);
        const goalForSnap: Goal = {
          target: profile.goal_rating,
          time_class: profile.goal_time_class,
          deadline: profile.goal_deadline ?? "",
          current_rating: currentRating,
          start_rating: startRating,
          points_gained_since_start: pointsGained,
          points_needed: Math.max(0, profile.goal_rating - (currentRating ?? 0)),
          days_left: profile.goal_horizon_weeks * 7,
          days_since_start: 0,
          rate_per_day_so_far: null,
          rate_per_day_needed: null,
          projection_at_deadline: null,
          on_track: false,
        };

        const snap = buildSnapshot(aggregates, goalForSnap, run_kind);
        await lease.guard();
        await appendSnapshot(userId, snap);
        await lease.guard();
      } catch (histErr) {
        if (histErr instanceof LeaseOwnershipLostError) throw histErr;
        // eslint-disable-next-line no-console
        console.warn("[orchestrator] history snapshot fallito (best-effort, ignoro):", histErr);
      }
    } catch (e) {
      const msg = jobErrorMessage(e);
      if (e instanceof LeaseOwnershipLostError) throw e;
      await lease.complete("error", msg);
      // BACKGROUND: il profilo e' gia' 'ready', NON riportarlo a 'error'
      // (sbatterebbe l'utente fuori dal Tavolo). Il job resta 'error': al
      // prossimo avvio l'error-recovery riprende e ritenta il coaching finale.
      throw e;
    }
    try {
      await enforceCorpusRetention(goalTimeClass, () => lease.guard());
    } catch (pruneError) {
      if (pruneError instanceof LeaseOwnershipLostError) throw pruneError;
      // Retention cleanup is durable and must not invalidate a valid profile.
      // eslint-disable-next-line no-console
      console.warn("[orchestrator] corpus retention deferred:", pruneError);
    }
    await updateJobOrThrow(
      job.id,
      lease.token,
      {
        games_total: completionCoverage.selected,
        games_done: completionCoverage.succeeded,
      },
      "analysis_completion_failed",
    );
    await lease.complete("done", serializePartialAnalysis(completionCoverage));
    emit({
      phase: "ready",
      gamesTotal: completionCoverage.selected,
      gamesDone: completionCoverage.selected,
      gamesAnalyzed: completionCoverage.succeeded,
      corpusFinalized: true,
      coverage: completionCoverage,
    });
    currentOnBackgroundDone?.(completionCoverage, job.id);
  }
  } finally {
    try {
      const released = await lease.release();
      if (!released) console.warn("[orchestrator] lease already lost before release");
    } catch (releaseError) {
      console.warn("[orchestrator] lease release failed:", releaseError);
    }
  }
}

/**
 * Blocco aggregate + coach riusabile (gira su tutte le partite 'done' correnti).
 * Chiamato due volte: parziale sulla prima fetta e finale sul corpus trovato. NON imposta il profilo
 * 'ready' — quella responsabilità resta al coaching finale nel doRun.
 */
async function runAggregateAndCoach(
  userId: string,
  profile: ProfileRow,
  guardLease: () => Promise<void>,
  onActivity?: (activity: AnalysisActivity) => void,
): Promise<void> {
  const { timeClass: goalTimeClass } = goalAnalysisScope(profile.goal_time_class);
  const currentRating = await deriveCurrentRating(userId, profile);
  const targetRating = profile.goal_rating ?? undefined;
  const aggregates = await computeAggregates(
    userId,
    goalTimeClass,
    currentRating,
    targetRating,
    guardLease,
    onActivity,
  );

  // Reconnect trained patterns to genuinely new source-game opportunities.
  // Failure remains retryable on the next aggregation; the raw ledger still
  // lets the progress page reconstruct the observed comparison immediately.
  try {
    await guardLease();
    await syncPatternTransfers(userId, aggregates.personal_patterns?.observations ?? [], guardLease);
  } catch (learningError) {
    if (learningError instanceof LeaseOwnershipLostError) throw learningError;
    console.warn("[orchestrator] pattern transfer persistence deferred");
  }

  onActivity?.({ stage: "profile" });
  // ---- PlayerModelLite (best-effort) ----
  try {
    const { data: doneGames, error: doneGamesError } = await supabase
      .from("games")
      .select("*")
      .eq("user_id", userId)
      .eq("analysis_status", "done")
      .eq("time_class", goalTimeClass)
      .order("played_at", { ascending: false })
      .limit(FREE_GAME_CAP);

    if (doneGamesError) {
      throw new Error(`player_model_games_select_failed:${doneGamesError.message}`);
    }

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
    const startRatingForPm = deriveStartRating(
      existingHistoryForPm,
      currentRating,
      goalTimeClass,
    );

    const pmLite = buildPlayerModelLite(gameRows, analyses, profile, startRatingForPm);
    await guardLease();
    await uploadJson(quadernoPath(userId, "player_model_lite.json"), pmLite);
    await guardLease();
  } catch (pmErr) {
    if (pmErr instanceof LeaseOwnershipLostError) throw pmErr;
    // eslint-disable-next-line no-console
    console.warn("[orchestrator] buildPlayerModelLite fallito (best-effort):", pmErr);
  }

  onActivity?.({ stage: "coach" });
  // Coach LLM = best-effort.
  try {
    await guardLease();
    await invokeCoachLlm(userId, profile, aggregates);
    await guardLease();
  } catch (coachErr) {
    if (coachErr instanceof LeaseOwnershipLostError) throw coachErr;
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
  existingHistory: {
    snapshots: Array<{
      captured_at: string;
      goal: { current: number | null; time_class: string };
    }>;
  },
  currentRating: number | null,
  goalTimeClass: AnalyzedTimeClass,
): number | null {
  const sameCadence = existingHistory.snapshots.filter(
    (snapshot) => snapshot.goal.time_class === goalTimeClass,
  );
  if (sameCadence.length === 0) return currentRating;
  // Oldest snapshot della stessa cadenza = baseline immutabile pertinente.
  const sorted = [...sameCadence].sort((a, b) =>
    a.captured_at.localeCompare(b.captured_at),
  );
  return sorted[0].goal.current ?? currentRating;
}

/** Deriva il rating corrente solo dalla goal time class. */
async function deriveCurrentRating(userId: string, profile: ProfileRow): Promise<number | null> {
  const { timeClass: goalTc } = goalAnalysisScope(profile.goal_time_class);
  const { data: ratingRows, error: ratingError } = await supabase
    .from("games")
    .select("player_rating")
    .eq("user_id", userId)
    .eq("time_class", goalTc)
    .not("player_rating", "is", null)
    .order("played_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ratingError) throw new Error(`current_rating_select_failed:${ratingError.message}`);
  if (ratingRows?.player_rating != null) return ratingRows.player_rating as number;
  // Nessun fallback cross-cadenza: un rating blitz non deve parametrizzare
  // posizioni rapid (o viceversa).
  return null;
}

/**
 * Restituisce il played_at (ISO string) della partita più recente dell'utente,
 * o null se non ci sono partite. Usato da runRefresh e runSilentRefresh.
 */
export async function getLatestGamePlayedAt(
  userId: string,
  goalTimeClass: AnalyzedTimeClass,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("games")
    .select("played_at")
    .eq("user_id", userId)
    .eq("time_class", goalTimeClass)
    .order("played_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latest_game_select_failed:${error.message}`);
  return (data as { played_at: string } | null)?.played_at ?? null;
}

async function probeNewChessComGames(
  chessComUsername: string,
  goalTimeClass: AnalyzedTimeClass,
  latestPlayedAt: string | null,
): Promise<number> {
  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(chessComUsername)}/games/archives`,
  );
  if (!archivesRes.ok) throw new Error(`Chess.com archives ${archivesRes.status}`);
  const archivesData = (await archivesRes.json()) as { archives?: string[] };
  const recentArchives = (archivesData.archives ?? []).slice().reverse();
  const cutoff = latestPlayedAt ? new Date(latestPlayedAt).getTime() / 1000 : 0;
  let successfulArchives = 0;
  let newGameCount = 0;

  for (const archiveUrl of recentArchives) {
    const gamesRes = await fetch(archiveUrl);
    if (!gamesRes.ok) continue;
    successfulArchives += 1;
    const gamesData = (await gamesRes.json()) as {
      games?: Array<{ end_time?: number; time_class?: string }>;
    };
    const games = gamesData.games ?? [];
    newGameCount += countNewGoalGames(
      games,
      goalTimeClass,
      cutoff,
      FREE_GAME_CAP - newGameCount,
    );
    if (newGameCount >= FREE_GAME_CAP) return FREE_GAME_CAP;
    if (games.some((game) => (game.end_time ?? 0) <= cutoff)) break;
  }

  if (recentArchives.length > 0 && successfulArchives === 0) {
    throw new Error("archive_fetch_failed_all");
  }
  return newGameCount;
}

/**
 * Refresh (loop di ritorno): l'utente torna dopo qualche giorno → nuovo job +
 * profilo 'pending'. La waiting page riusa runOnboardingOrchestrator: ingest
 * prende solo le partite nuove (delta da refresh_after), analyze le nuove,
 * aggregate, coach (nuova voce nel Quaderno via append lato edge function).
 */
export async function runRefresh(profile: ProfileRow, options: { rebuildExisting?: boolean } = {}): Promise<boolean> {
  if (activeRun) throw new Error("analysis_run_already_active");
  const { timeClass: goalTimeClass } = goalAnalysisScope(profile.goal_time_class);
  const latest = await getLatestGamePlayedAt(profile.user_id, goalTimeClass);
  const newGameCount = await probeNewChessComGames(
    profile.chess_com_username,
    goalTimeClass,
    latest,
  );
  if (newGameCount === 0 && !options.rebuildExisting) return false;
  const { data: jobId, error } = await supabase.rpc("start_analysis_refresh", {
    p_goal_time_class: goalTimeClass,
    p_refresh_after: latest,
  });
  if (error || !jobId) {
    throw new Error(`start_analysis_refresh_failed:${error?.message ?? "missing_job_id"}`);
  }
  return true;
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
  if (activeRun) throw new Error("analysis_run_already_active");
  const { timeClass: goalTimeClass } = goalAnalysisScope(profile.goal_time_class);
  const { data: jobId, error } = await supabase.rpc("start_full_reanalysis", {
    p_goal_time_class: goalTimeClass,
  });
  if (error || !jobId) {
    throw new Error(`start_full_reanalysis_failed:${error?.message ?? "missing_job_id"}`);
  }
}

/**
 * Silent background refresh — runs while the user stays on the Tavolo.
 *
 * Contract:
 *   - ADDITIVE: does NOT touch profile.onboarding_state. A transient job is
 *     created atomically to serialize tabs, without entering the main UI state.
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
  const { timeClass: goalTimeClass } = goalAnalysisScope(profile.goal_time_class);

  // Guard: do not double-work if the main orchestrator is already running.
  if (activeRun) {
    onDone?.();
    return;
  }

  // Step 1: detect new games (same strategy as the old nudge check).
  const latestPlayedAt = await getLatestGamePlayedAt(userId, goalTimeClass);

  let newGameCount = 0;
  let resumableSilentJob: IngestJobRow | null;
  try {
    // Resume first: a partial ingest may already have advanced the latest game
    // timestamp, so probing from that newer value could hide older delta games.
    resumableSilentJob = await currentSilentJob(userId);
    if (!resumableSilentJob) {
      newGameCount = await probeNewChessComGames(
        profile.chess_com_username,
        goalTimeClass,
        latestPlayedAt,
      );
      if (newGameCount === 0) {
        // Close the query/probe race: another tab may have created a silent job
        // while this tab was reading Chess.com.
        resumableSilentJob = await currentSilentJob(userId);
      }
    }
  } catch (e) {
    // Network/DB failure is not fatal for the foreground product.
    // eslint-disable-next-line no-console
    console.warn("[runSilentRefresh] refresh check failed:", e);
    onDone?.();
    return;
  }

  if (!resumableSilentJob && newGameCount === 0) {
    onDone?.();
    return;
  }

  if (newGameCount > 0) onNewGames?.(newGameCount);

  // Step 2: ingest delta only. The persisted silent job owns the original
  // refresh_after cutoff across crashes/takeovers; profile stays "ready".
  //
  // Re-check guard: if activeRun appeared while we were fetching Chess.com, abort.
  if (activeRun) {
    onDone?.();
    return;
  }

  let silentLease: IngestJobLease | null = null;

  try {
    onProgress?.("Sto guardando le tue ultime partite...");

    // The RPC serializes creation/adoption and gives main work priority.
    const { data: silentJobId, error: jobErr } = await supabase.rpc(
      "start_silent_refresh",
      {
        p_goal_time_class: goalTimeClass,
        p_refresh_after: latestPlayedAt,
      },
    );
    if (jobErr || !silentJobId) {
      throw new Error(
        `[runSilentRefresh] start job failed: ${jobErr?.message ?? "no data"}`,
      );
    }
    const acquisition = await acquireOrObserveIngestJob({
      jobId: silentJobId,
      userId,
      goalTimeClass,
      expectedKind: "silent",
      onObserved: (observedJob) => {
        const total = Math.max(observedJob.games_total, newGameCount);
        if (observedJob.status === "coaching") {
          onProgress?.("Un'altra scheda sta aggiornando il profilo...");
        } else if (observedJob.status === "done" || observedJob.status === "error") {
          onProgress?.("Aggiornamento concluso in un'altra scheda.");
        } else {
          onProgress?.(
            `Un'altra scheda sta elaborando ${observedJob.games_done}/${total} partite...`,
          );
        }
      },
    });
    if (acquisition.outcome === "terminal") return;
    silentLease = acquisition.lease;
    await silentLease.guard();
    const { data: persistedSilentJob, error: persistedSilentJobError } = await supabase
      .from("ingest_jobs")
      .select("*")
      .eq("id", silentJobId)
      .eq("user_id", userId)
      .maybeSingle();
    await silentLease.guard();
    if (persistedSilentJobError || !persistedSilentJob) {
      throw new Error(
        `silent_ingest_job_select_failed:${persistedSilentJobError?.message ?? "missing_job"}`,
      );
    }
    if (persistedSilentJob.kind !== "silent") {
      throw new Error(`ingest_job_kind_mismatch:${persistedSilentJob.kind}`);
    }
    const persistedRefreshAfter = persistedSilentJob.refresh_after;

    // Ingest delta.
    await runIngest({
      userId,
      chessComUsername: profile.chess_com_username,
      goalTimeClass,
      gameCap: FREE_GAME_CAP,
      jobId: silentJobId,
      leaseToken: silentLease.token,
      guardLease: () => silentLease!.guard(),
      refreshAfter: persistedRefreshAfter ?? undefined,
      onProgress: (p) => {
        onProgress?.(`Scarico ${p.gamesDone}/${p.gamesTotal} partite...`);
      },
    });

    // Step 3: analyze new games only (those still 'pending' after ingest).
    await updateJobOrThrow(
      silentJobId,
      silentLease.token,
      { status: "analyzing" },
      "silent_analysis_checkpoint_failed",
    );
    onProgress?.("Analizzo con Stockfish...");
    await runAnalyze({
      userId,
      jobId: silentJobId,
      leaseToken: silentLease.token,
      guardLease: () => silentLease!.guard(),
      pulseLease: () => silentLease!.pulse(),
      goalTimeClass,
      // No range: analyze whatever is pending (only the newly ingested games).
      onProgress: (progress) => {
        onProgress?.(
          `Analizzo ${progress.processed}/${progress.total} partite (${progress.succeeded} riuscite)...`,
        );
      },
    });

    // Step 4: re-aggregate + player_model_lite + coach (full, on all done games).
    await updateJobOrThrow(
      silentJobId,
      silentLease.token,
      { status: "coaching" },
      "silent_coaching_checkpoint_failed",
    );
    onProgress?.("Aggiorno il profilo...");
    await silentLease.guard();
    await runAggregateAndCoach(userId, profile, () => silentLease!.guard());
    await silentLease.guard();

    try {
      await silentLease.guard();
      await enforceCorpusRetention(goalTimeClass, () => silentLease!.guard());
      await silentLease.guard();
    } catch (pruneError) {
      if (pruneError instanceof LeaseOwnershipLostError) throw pruneError;
      // Queue survives the tab and will be drained by a later run.
      // eslint-disable-next-line no-console
      console.warn("[runSilentRefresh] corpus retention deferred:", pruneError);
    }

    await silentLease.complete("done", null);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[runSilentRefresh] error during background refresh:", e);
    // Keep infrastructure failures resumable with the original refresh_after.
    // A token-losing worker must not overwrite the takeover worker.
    if (silentLease && !(e instanceof LeaseOwnershipLostError)) {
      try {
        await updateJobOrThrow(
          silentLease.jobId,
          silentLease.token,
          { error: jobErrorMessage(e) },
          "silent_error_checkpoint_failed",
        );
      } catch (checkpointError) {
        // eslint-disable-next-line no-console
        console.warn("[runSilentRefresh] failed to checkpoint job error:", checkpointError);
      }
    }
  } finally {
    if (silentLease) {
      try {
        const released = await silentLease.release();
        if (!released) {
          // eslint-disable-next-line no-console
          console.warn("[runSilentRefresh] lease already lost before release");
        }
      } catch (releaseError) {
        // eslint-disable-next-line no-console
        console.warn("[runSilentRefresh] lease release failed:", releaseError);
      }
    }
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
      lang: getLang(),
    },
  });
  if (error) throw new Error(`coach-llm: ${error.message}`);
}
