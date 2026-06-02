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
  /** True quando il coaching finale (su 100 partite) è completato. */
  backgroundDone: boolean;
  /**
   * Contatore monotono che si incrementa ogni volta che il background finisce
   * (sia la pipeline 20+80 sia il silent-refresh). TavoloHome e Sessione lo
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
  const [dataVersion, setDataVersion] = useState(0);
  const [silentRefreshing, setSilentRefreshing] = useState(false);

  // backgroundRunning: il secondo lotto è partito ma non ancora finito.
  // Lo deriviamo: firstBatchReady è true, backgroundDone è false.
  const backgroundRunning = firstBatchReady && !backgroundDone;

  // Ref per evitare che il cleanup di StrictMode / re-mount annulli i setter
  // dopo che il provider è già stato rimontato.
  const cancelledRef = useRef(false);
  // Guard anti-reentrancy per il silent-refresh.
  const silentRefreshInFlightRef = useRef(false);

  // Ri-lanciamo l'orchestratore quando il profilo COMPARE (signup) o quando lo
  // stato torna non-ready (Rianalizza/Refresh resettano il lock): in quei casi
  // l'userId NON cambia, quindi onboarding_state DEVE stare nelle deps, sennò
  // l'effetto non rigira e nessuno chiama doRun (era "Dammi un attimo" eterno).
  // L'idempotenza la garantisce activeRun: job 'done' = no-op, run in corso riusato.
  const userId = profile?.user_id;

  const handleProgress = useCallback((p: OrchestratorProgress) => {
    if (!cancelledRef.current) setProgress(p);
  }, []);

  const handleFirstBatchReady = useCallback(() => {
    if (cancelledRef.current) return;
    setFirstBatchReady(true);
    // Refresha il profilo così HomeGate legge onboarding_state = 'ready'
    // e lascia passare l'utente al Tavolo.
    void refreshProfile();
  }, [refreshProfile]);

  const handleBackgroundDone = useCallback(() => {
    if (cancelledRef.current) return;
    setBackgroundDone(true);
    setDataVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!userId || !profile) return;

    cancelledRef.current = false;

    // (Ri)partenza da uno stato non-ready = run NUOVO (signup, Rianalizza,
    // Refresh): azzera i flag della sessione precedente, così la scena mostra
    // di nuovo l'attesa e non il vecchio primo colpo. Sullo stato 'ready' (la
    // transizione di meta'-run dopo le 20) NON azzeriamo.
    if (profile.onboarding_state !== "ready") {
      setFirstBatchReady(false);
      setBackgroundDone(false);
      setError(null);
      setProgress(null);
    }

    const currentProfile = profile;

    runOnboardingOrchestrator({
      profile: currentProfile,
      onProgress: handleProgress,
      onFirstBatchReady: handleFirstBatchReady,
      onBackgroundDone: handleBackgroundDone,
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
          setError(String(e instanceof Error ? e.message : e));
        }
      });

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.onboarding_state]);

  return (
    <Ctx.Provider
      value={{ progress, error, firstBatchReady, backgroundRunning, backgroundDone, dataVersion, silentRefreshing }}
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
