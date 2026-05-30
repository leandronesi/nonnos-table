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
 * CRITICO: deps [profile?.user_id] — stessa disciplina anti-loop di
 * OnboardingWaiting. NON aggiungere profile.onboarding_state alle deps.
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
  type OrchestratorProgress,
} from "./orchestrator";

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
   * Contatore monotono che si incrementa ogni volta che il background finisce.
   * TavoloHome lo mette nelle deps del suo useEffect per ricaricare i dati
   * senza window.location.reload().
   */
  dataVersion: number;
}

const Ctx = createContext<OnboardingRunCtx | null>(null);

export function OnboardingRunProvider({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useAuth();

  const [progress, setProgress] = useState<OrchestratorProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstBatchReady, setFirstBatchReady] = useState(false);
  const [backgroundDone, setBackgroundDone] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  // backgroundRunning: il secondo lotto è partito ma non ancora finito.
  // Lo deriviamo: firstBatchReady è true, backgroundDone è false.
  const backgroundRunning = firstBatchReady && !backgroundDone;

  // Ref per evitare che il cleanup di StrictMode / re-mount annulli i setter
  // dopo che il provider è già stato rimontato.
  const cancelledRef = useRef(false);

  // CRITICO: deps [profile?.user_id] — non aggiungere onboarding_state.
  // Se il profilo è già 'ready' (utente di ritorno), lanciamo comunque
  // l'orchestratore: activeRun + doRun garantiscono no-op se job è 'done',
  // ma riprendono il background se analyzing_rest era interrotto.
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

    runOnboardingOrchestrator({
      profile,
      onProgress: handleProgress,
      onFirstBatchReady: handleFirstBatchReady,
      onBackgroundDone: handleBackgroundDone,
    }).catch((e) => {
      if (!cancelledRef.current) {
        setError(String(e instanceof Error ? e.message : e));
      }
    });

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <Ctx.Provider
      value={{ progress, error, firstBatchReady, backgroundRunning, backgroundDone, dataVersion }}
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
