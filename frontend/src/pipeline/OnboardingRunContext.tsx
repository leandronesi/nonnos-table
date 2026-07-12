/**
 * OnboardingRunContext — possiede il run dell'orchestratore a livello app.
 *
 * Montato sopra BrowserRouter in App.tsx, sopravvive alla navigazione.
 * Responsabilità:
 *   - Lancia runOnboardingOrchestrator una sola volta per user_id (activeRun
 *     garantisce l'idempotenza per sessione; doRun ritorna subito se il job è
 *     già 'done').
 *   - Espone progress, error, firstBatchReady, backgroundRunning, backgroundDone.
 *   - Al firstBatchReady: chiama refreshProfile() → HomeGate vede profile.ready
 *     e lascia entrare al Tavolo.
 *   - Riparte il background se l'utente riapre la scheda con profilo già 'ready'
 *     (es. analyzing_rest interrotto): activeRun è null al mount → doRun riparte.
 *
 * Deps [userId, onboarding_state]: riparte su signup (il profilo compare) e su
 * Rianalizza/Refresh (stato non-ready, userId invariato). activeRun rende
 * idempotente ogni ri-esecuzione (no doppio run, no loop).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/AuthContext";
import {
  runOnboardingOrchestrator,
  runSilentRefresh,
  silentRefreshThrottleKey,
  type OrchestratorProgress,
} from "./orchestrator";
import { trackEvent } from "../lib/telemetry";
import { getLang } from "../i18n/lang";
import { pipelineErrorMessage } from "./pipelineErrors";
import { isAnalyzedTimeClass } from "./config";
import type { AnalysisCoverage } from "./analysisRunSemantics";

const SILENT_REFRESH_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

function shouldRunSilentRefresh(userId: string): boolean {
  try {
    const raw = localStorage.getItem(silentRefreshThrottleKey(userId));
    if (!raw) return true;
    const ts = parseInt(raw, 10);
    if (Number.isNaN(ts)) return true;
    return Date.now() - ts > SILENT_REFRESH_TTL_MS;
  } catch {
    return true;
  }
}

function markSilentRefreshDone(userId: string): void {
  try {
    localStorage.setItem(silentRefreshThrottleKey(userId), String(Date.now()));
  } catch {
    // localStorage unavailable — not fatal.
  }
}

interface OnboardingRunCtx {
  progress: OrchestratorProgress | null;
  error: string | null;
  /** True dal momento in cui il coaching_first è completo (profilo → ready). */
  firstBatchReady: boolean;
  /** True mentre il secondo lotto (analyzing_rest → coaching) è in corso. */
  backgroundRunning: boolean;
  /** Errore user-facing del secondo lotto; la prima lettura resta utilizzabile. */
  backgroundError: string | null;
  /** Copertura terminale reale; failed > 0 indica un profilo parziale. */
  backgroundCoverage: AnalysisCoverage | null;
  /** Riprova il checkpoint persistito senza invalidare la prima lettura. */
  retryBackground: () => void;
  /** True quando il coaching finale sulle analisi riuscite è completato. */
  backgroundDone: boolean;
  /**
   * Contatore monotono che si incrementa ogni volta che il background finisce
   * (sia la pipeline a prima fetta + resto sia il silent-refresh). TavoloHome e Sessione lo
   * mettono nelle deps del loro useEffect per ricaricare i dati senza reload.
   */
  dataVersion: number;
  /**
   * True mentre runSilentRefresh sta girando in background (dopo la prima
   * apertura giornaliera). Usato dall'AppShell per mostrare l'indicatore
   * discreto nell'header.
   */
  silentRefreshing: boolean;
}

const Ctx = createContext<OnboardingRunCtx | null>(null);

export function OnboardingRunProvider({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useAuth();

  const [progress, setProgress] = useState<OrchestratorProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstBatchReady, setFirstBatchReady] = useState(false);
  const [backgroundDone, setBackgroundDone] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [backgroundCoverage, setBackgroundCoverage] = useState<AnalysisCoverage | null>(null);
  const [backgroundRetryVersion, setBackgroundRetryVersion] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [silentRefreshing, setSilentRefreshing] = useState(false);

  // backgroundRunning: il secondo lotto è partito ma non ancora finito.
  // Lo deriviamo: firstBatchReady è true, backgroundDone è false, E il run non è
  // già fermo su un emit terminale 'ready'. L'ultimo guard è cruciale per il caso
  // "quota <= FIRST_BATCH_SIZE": lì l'orchestratore finisce SENZA chiamare
  // onBackgroundDone (non c'è un resto da annunciare) ed emette phase 'ready'.
  // Senza questo guard backgroundRunning resterebbe true per sempre e il Tavolo
  // mostrerebbe "sto ancora guardando" anche quando non arriveranno altre partite.
  const backgroundPhase =
    progress?.phase === "analyzing" || progress?.phase === "coaching";
  const backgroundRunning =
    (firstBatchReady || profile?.onboarding_state === "ready") &&
    !backgroundDone &&
    backgroundError === null &&
    backgroundPhase;

  // Ref per evitare che il cleanup di StrictMode / re-mount annulli i setter
  // dopo che il provider è già stato rimontato.
  const cancelledRef = useRef(false);
  // Guard anti-reentrancy per il silent-refresh.
  const silentRefreshInFlightRef = useRef(false);
  const latestProgressRef = useRef<OrchestratorProgress | null>(null);
  const retryPartialRequestedRef = useRef(false);
  const firstBatchReadyRef = useRef(false);
  const analysisStartedTrackedRef = useRef(false);
  const firstReadingTrackedRef = useRef(false);
  const fullProfileTrackedRef = useRef(false);
  const partialProfileTrackedRef = useRef(false);

  // Ri-lanciamo l'orchestratore quando il profilo COMPARE (signup) o quando lo
  // stato torna non-ready (Rianalizza/Refresh resettano il lock): in quei casi
  // l'userId NON cambia, quindi onboarding_state DEVE stare nelle deps, sennò
  // l'effetto non rigira e nessuno chiama doRun (era "Dammi un attimo" eterno).
  // L'idempotenza la garantisce activeRun: job 'done' = no-op, run in corso riusato.
  const userId = profile?.user_id;

  const retryBackground = useCallback(() => {
    if (!profile || !isAnalyzedTimeClass(profile.goal_time_class)) return;
    // Un job parziale e' terminale finche' l'utente non lo riapre da questa CTA.
    // Per gli errori infrastrutturali resta valida la recovery dal checkpoint.
    retryPartialRequestedRef.current = true;
    partialProfileTrackedRef.current = false;
    setBackgroundError(null);
    setBackgroundCoverage(null);
    setBackgroundDone(false);
    setError(null);
    setBackgroundRetryVersion((version) => version + 1);
  }, [profile]);

  const trackPartialCoverage = useCallback((
    coverage: AnalysisCoverage,
    analysisRunId: string | undefined,
  ) => {
    if (
      coverage.failed <= 0 ||
      !analysisRunId ||
      partialProfileTrackedRef.current
    ) return;
    partialProfileTrackedRef.current = true;
    trackEvent("background_analysis_partial", {
      event_version: 1,
      games_selected: coverage.selected,
      games_analyzed: coverage.succeeded,
      games_failed: coverage.failed,
      completion_scope: "partial_available_profile",
      analysis_completion_id:
        `${analysisRunId}:${coverage.succeeded}/${coverage.selected}`,
    });
  }, []);

  const handleProgress = useCallback((p: OrchestratorProgress) => {
    latestProgressRef.current = p;
    if (p.coverage) {
      setBackgroundCoverage(p.coverage);
      trackPartialCoverage(p.coverage, p.analysisRunId);
    }
    if (firstBatchReadyRef.current && p.phase === "analyzing") {
      setBackgroundError(null);
    }
    if (!analysisStartedTrackedRef.current && p.phase === "analyzing") {
      analysisStartedTrackedRef.current = true;
      trackEvent("analysis_started", {
        event_version: 1,
        games_available: p.gamesTotal,
      });
    }
    if (
      !fullProfileTrackedRef.current &&
      p.phase === "ready" &&
      p.gamesTotal <= 10 &&
      (!p.coverage || p.coverage.failed === 0)
    ) {
      fullProfileTrackedRef.current = true;
      trackEvent("full_100_or_available_ready", {
        event_version: 1,
        games_analyzed: p.gamesAnalyzed,
        games_available: p.gamesTotal,
        completion_scope: "all_available_under_initial_batch",
      });
    }
    if (!cancelledRef.current) setProgress(p);
  }, [trackPartialCoverage]);

  const handleFirstBatchReady = useCallback(() => {
    if (cancelledRef.current) return;
    firstBatchReadyRef.current = true;
    setFirstBatchReady(true);
    if (!firstReadingTrackedRef.current) {
      firstReadingTrackedRef.current = true;
      const current = latestProgressRef.current;
      trackEvent("first_10_ready", {
        event_version: 1,
        games_analyzed: Math.min(10, current?.gamesAnalyzed ?? 0),
        games_available: current?.gamesTotal ?? null,
      });
    }
    // Refresha il profilo così HomeGate legge onboarding_state = 'ready'
    // e lascia passare l'utente all'introduzione una-tantum della Stanza.
    void refreshProfile();
  }, [refreshProfile]);

  const handleBackgroundDone = useCallback((
    coverage: AnalysisCoverage,
    analysisRunId: string,
  ) => {
    if (cancelledRef.current) return;
    setBackgroundError(null);
    setBackgroundCoverage(coverage);
    setBackgroundDone(true);
    setDataVersion((v) => v + 1);
    if (coverage.failed > 0) {
      trackPartialCoverage(coverage, analysisRunId);
      return;
    }
    if (!fullProfileTrackedRef.current) {
      fullProfileTrackedRef.current = true;
      const current = latestProgressRef.current;
      trackEvent("full_100_or_available_ready", {
        event_version: 1,
        games_analyzed: current?.gamesAnalyzed ?? null,
        games_available: current?.gamesTotal ?? null,
        completion_scope: "full_available_profile",
      });
    }
  }, [trackPartialCoverage]);

  useEffect(() => {
    if (!userId || !profile) return;

    cancelledRef.current = false;

    // I profili legacy restano rappresentabili a DB finche' la constraint
    // staged non e' validata. Non avviare una pipeline con una cadenza inventata:
    // la waiting page chiede una scelta esplicita rapid/blitz via RPC atomica.
    if (!isAnalyzedTimeClass(profile.goal_time_class)) {
      firstBatchReadyRef.current = false;
      latestProgressRef.current = null;
      setFirstBatchReady(false);
      setBackgroundDone(false);
      setBackgroundError(null);
      setBackgroundCoverage(null);
      setError(null);
      setProgress(null);
      return;
    }

    // (Ri)partenza da uno stato non-ready = run NUOVO (signup, Rianalizza,
    // Refresh): azzera i flag della sessione precedente, così la scena mostra
    // di nuovo l'attesa e non il vecchio primo colpo. Sullo stato 'ready' (la
    // transizione dopo la prima lettura di 10 partite) NON azzeriamo.
    if (profile.onboarding_state !== "ready") {
      firstBatchReadyRef.current = false;
      analysisStartedTrackedRef.current = false;
      firstReadingTrackedRef.current = false;
      fullProfileTrackedRef.current = false;
      partialProfileTrackedRef.current = false;
      latestProgressRef.current = null;
      setFirstBatchReady(false);
      setBackgroundDone(false);
      setBackgroundError(null);
      setBackgroundCoverage(null);
      setError(null);
      setProgress(null);
    }

    const currentProfile = profile;
    const retryPartial = retryPartialRequestedRef.current;
    retryPartialRequestedRef.current = false;

    runOnboardingOrchestrator({
      profile: currentProfile,
      onProgress: handleProgress,
      onFirstBatchReady: handleFirstBatchReady,
      onBackgroundDone: handleBackgroundDone,
      retryPartial,
    })
      .then(() => {
        // Silent daily refresh — CHAINED on the main run, NOT a separate effect.
        // runOnboardingOrchestrator sets the `activeRun` lock SYNCHRONOUSLY and
        // clears it only when the run settles. A separate effect runs on the same
        // mount tick, right after this one, while the lock is still held → its
        // `if (activeRun)` guard would abort every single time and the refresh
        // would never run. Chaining here guarantees the main run has settled
        // (lock cleared) before we start, so runSilentRefresh actually proceeds.
        if (cancelledRef.current) return;
        if (currentProfile.onboarding_state !== "ready") return;
        // Una copertura parziale resta visibile e stabile finche' l'utente non
        // sceglie di ritentare; non mascherarla con un refresh silenzioso.
        if ((latestProgressRef.current?.coverage?.failed ?? 0) > 0) return;
        if (!shouldRunSilentRefresh(userId)) return;
        if (silentRefreshInFlightRef.current) return;

        silentRefreshInFlightRef.current = true;
        setSilentRefreshing(true);

        void runSilentRefresh(currentProfile, {
          onDone: () => {
            silentRefreshInFlightRef.current = false;
            // Throttle marked when done (covers the no-new-games no-op too).
            markSilentRefreshDone(userId);
            if (!cancelledRef.current) setSilentRefreshing(false);
            // Bump dataVersion so Tavolo + Sessione reload their data.
            if (!cancelledRef.current) setDataVersion((v) => v + 1);
          },
        });
      })
      .catch((e) => {
        if (!cancelledRef.current) {
          const rawError = String(e instanceof Error ? e.message : e);
          // Il codice tecnico resta nel job/log per il retry; l'utente vede una
          // spiegazione concreta, mai uno stack o un profilo vuoto mascherato.
          console.warn("[onboarding] pipeline failed:", rawError);
          const userMessage = pipelineErrorMessage(rawError, getLang());
          if (
            firstBatchReadyRef.current ||
            currentProfile.onboarding_state === "ready"
          ) {
            // La prima lettura resta valida. Il fallimento del completamento e'
            // distinto, ferma l'indicatore e resta consumabile dalla UI.
            setBackgroundError(userMessage);
          } else {
            setError(userMessage);
          }
        }
      });

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.onboarding_state, profile?.goal_time_class, backgroundRetryVersion]);

  return (
    <Ctx.Provider
      value={{
        progress,
        error,
        firstBatchReady,
        backgroundRunning,
        backgroundError,
        backgroundCoverage,
        retryBackground,
        backgroundDone,
        dataVersion,
        silentRefreshing,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useOnboardingRun(): OnboardingRunCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOnboardingRun deve stare dentro <OnboardingRunProvider>");
  return ctx;
}
