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

export function resetActiveLock(): void {
  activeRun = null;
  currentOnProgress = null;
}

export function runOnboardingOrchestrator(opts: {
  profile: ProfileRow;
  onProgress?: (p: OrchestratorProgress) => void;
}): Promise<void> {
  // Aggiorna SEMPRE il listener vivo, anche se un run è già in corso.
  currentOnProgress = opts.onProgress ?? null;
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

    // Profilo NON è 'ready' qui: è un aggregate parziale, solo per il Quaderno interno.
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
    } else {
      // Quota <= FIRST_BATCH_SIZE o tutte già analizzate: vai dritto al coaching finale.
      await supabase.from("ingest_jobs").update({ status: "coaching" }).eq("id", job.id);
    }
    job = (await currentJob(userId)) ?? job;
  }

  // ---- Step 2c: ANALYZE REST (partite 21-100) ----
  if (job.status === "analyzing_rest") {
    await setProfileState(userId, "analyzing");
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
      await setProfileState(userId, "error", msg);
      throw e;
    }
    await supabase.from("ingest_jobs").update({ status: "coaching" }).eq("id", job.id);
    job = (await currentJob(userId)) ?? job;
  }

  // ---- Step 3: AGGREGATE + COACH FINALE (tutte le done, max 100) ----
  if (job.status === "coaching") {
    await setProfileState(userId, "coaching");
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

        // Use goal from pmLite if available; build minimal fallback otherwise.
        const goalForSnap: Goal = {
          target: profile.goal_rating,
          time_class: profile.goal_time_class,
          deadline: profile.goal_deadline ?? "",
          current_rating: currentRating,
          start_rating: currentRating,
          points_gained_since_start: 0,
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
      await setProfileState(userId, "error", msg);
      throw e;
    }
    await supabase
      .from("ingest_jobs")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", job.id);
    await setProfileState(userId, "ready");
    emit({ phase: "ready" });
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

    const pmLite = buildPlayerModelLite(gameRows, analyses, profile);
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
 * o null se non ci sono partite. Usato da runRefresh per impostare refresh_after.
 */
async function getLatestGamePlayedAt(userId: string): Promise<string | null> {
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
