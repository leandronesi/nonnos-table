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
    const recoverTo: "queued" | "analyzing" = (gameCount ?? 0) > 0 ? "analyzing" : "queued";
    await supabase
      .from("ingest_jobs")
      .update({ status: recoverTo, error: null })
      .eq("id", job.id);
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
    const { count: pendingCount } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("analysis_status", "pending");
    // If there are un-analyzed games → re-analyze; otherwise re-aggregate + coach.
    const recoverTo: "analyzing" | "coaching" = (pendingCount ?? 0) > 0 ? "analyzing" : "coaching";
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
    await supabase.from("ingest_jobs").update({ status: "analyzing" }).eq("id", job.id);
    job = (await currentJob(userId)) ?? job;
  }

  // ---- Step 2: ANALYZE ----
  if (job.status === "analyzing" || job.status === "fetching") {
    await setProfileState(userId, "analyzing");
    emit({ phase: "analyzing", message: "Analizzo le partite con Stockfish…" });
    try {
      await runAnalyze({
        userId,
        jobId: job.id,
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

  // ---- Step 3: AGGREGATE + COACH ----
  if (job.status === "coaching") {
    await setProfileState(userId, "coaching");
    emit({ phase: "coaching", message: "Confronto col tuo livello (Maia)…" });
    try {
      // Derive currentRating: most recent player_rating in goal_time_class.
      const currentRating = await (async (): Promise<number | null> => {
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
      })();
      const targetRating = profile.goal_rating ?? undefined;
      const aggregates = await computeAggregates(userId, currentRating, targetRating);

      // ---- PlayerModelLite (best-effort, non blocca il coaching se fallisce) ----
      let pmLiteGoal: Goal | null = null;
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
        pmLiteGoal = pmLite.identity.goal;
      } catch (pmErr) {
        // eslint-disable-next-line no-console
        console.warn("[orchestrator] buildPlayerModelLite fallito (best-effort):", pmErr);
      }

      // ---- History snapshot (best-effort, non blocca mai ready) ----
      try {
        // Determine run_kind:
        //   refresh_after set         → "refresh" (returning user, delta ingest)
        //   refresh_after null + existing history → "reanalyze" (full reprocess)
        //   refresh_after null + no history       → "onboarding" (first run)
        const existingHistory = await readHistory(userId);
        let run_kind: HistorySnapshot["run_kind"];
        if (job.refresh_after != null) {
          run_kind = "refresh";
        } else if (existingHistory.snapshots.length > 0) {
          run_kind = "reanalyze";
        } else {
          run_kind = "onboarding";
        }

        // Use the goal from pmLite if available; else build a minimal fallback.
        const goalForSnap: Goal = pmLiteGoal ?? {
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

      // Coach LLM = best-effort. Se fallisce (rate-limit, OpenAI giù, ecc.) il
      // Tavolo si apre COMUNQUE: aggregates.json + player_model_lite.json sono
      // già scritti sopra. Il brief (voce di Nonno) è un di più, non un blocco.
      try {
        await invokeCoachLlm(userId, profile, aggregates);
      } catch (coachErr) {
        // eslint-disable-next-line no-console
        console.warn("[orchestrator] coach-llm fallito (best-effort, apro il Tavolo lo stesso):", coachErr);
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
  // 2. Nuovo job che parte direttamente da 'analyzing' (niente re-download).
  await supabase.from("ingest_jobs").insert({
    user_id: userId,
    status: "analyzing",
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
