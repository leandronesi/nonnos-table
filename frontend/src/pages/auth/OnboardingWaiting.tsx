/**
 * OnboardingWaiting — container "Il Primo Incontro".
 *
 * Consumatore puro: non lancia più runOnboardingOrchestrator da solo.
 * Il run vive in OnboardingRunProvider (App.tsx), sopravvive alla navigazione.
 *
 * Redirect logic:
 *   - profile.onboarding_state === "ready" E firstBatchReady === false
 *     → utente di ritorno già onboardato: vai dritto al Tavolo (replace).
 *   - profile.onboarding_state === "ready" E firstBatchReady === true
 *     → utente nuovo: resta qui, carica coach_brief e mostra PrimoColpo.
 *
 * LOGICA INVARIATA: NON reintroduce il bug del loop "Mi preparo".
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { downloadJson, quadernoPath } from "../../auth/storage";
import { useOnboardingRun } from "../../pipeline/OnboardingRunContext";
import { IncontroScene, type CoachLlmBrief } from "./IncontroScene";

export function OnboardingWaiting() {
  const nav = useNavigate();
  const { profile, signOut } = useAuth();
  const { progress, error, firstBatchReady } = useOnboardingRun();

  // undefined = non ancora in stato ready
  // null = brief fallito o non trovato (mostra fallback)
  // CoachLlmBrief = brief caricato
  const [readyBrief, setReadyBrief] = useState<CoachLlmBrief | null | undefined>(undefined);

  // Redirect: utente di ritorno già onboardato (profilo ready, ma firstBatchReady
  // è false perché non ha appena completato l'onboarding in questa sessione).
  useEffect(() => {
    if (!profile) return;
    if (profile.onboarding_state === "ready" && !firstBatchReady) {
      nav("/", { replace: true });
    }
  }, [profile, firstBatchReady, nav]);

  // Quando firstBatchReady diventa true: carica il coach_brief e mostralo.
  useEffect(() => {
    if (!firstBatchReady || !profile?.user_id) return;
    let cancelled = false;
    downloadJson<CoachLlmBrief>(quadernoPath(profile.user_id, "coach_brief.json"))
      .then((brief) => {
        if (!cancelled) setReadyBrief(brief);
      })
      .catch(() => {
        if (!cancelled) setReadyBrief(null);
      });
    return () => {
      cancelled = true;
    };
  }, [firstBatchReady, profile?.user_id]);

  if (!profile) {
    return (
      <div
        style={{
          minHeight: "100svh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-bg, #060814)",
          padding: "2rem",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            color: "var(--color-muted, #717892)",
          }}
        >
          Recupero il tuo profilo.
        </p>
      </div>
    );
  }

  return (
    <IncontroScene
      progress={progress}
      readyBrief={readyBrief}
      error={error}
      onEnter={() => nav("/", { replace: true })}
      onExit={() => void signOut()}
      targetRating={profile.goal_rating > 0 ? profile.goal_rating : undefined}
    />
  );
}
