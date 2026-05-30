/**
 * OnboardingWaiting — container "Il Primo Incontro".
 *
 * Motore: runOnboardingOrchestrator + supabase + auth.
 * Presentazione: delegata interamente a <IncontroScene>.
 *
 * LOGICA INVARIATA: useEffect con deps [profile?.user_id], bug del loop
 * "Mi preparo" gia' risolto, NON reintrodotto.
 * Al ready: carica coach_brief.json e mostra il primo colpo via IncontroScene.
 * Se l'utente e' gia' ready al mount, naviga subito a "/".
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { supabase } from "../../auth/supabaseClient";
import { downloadJson, quadernoPath } from "../../auth/storage";
import { runOnboardingOrchestrator, type OrchestratorProgress } from "../../pipeline/orchestrator";
import { IncontroScene, type CoachLlmBrief } from "./IncontroScene";

export function OnboardingWaiting() {
  const nav = useNavigate();
  const { profile, refreshProfile, signOut } = useAuth();
  const [progress, setProgress] = useState<OrchestratorProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // undefined = non ancora in stato ready
  // null = brief fallito o non trovato (mostra fallback)
  // CoachLlmBrief = brief caricato
  const [readyBrief, setReadyBrief] = useState<CoachLlmBrief | null | undefined>(undefined);

  // CRITICO: deps su [profile?.user_id] per non reintrodurre il bug del loop.
  useEffect(() => {
    if (profile?.onboarding_state === "ready") {
      nav("/", { replace: true });
      return;
    }
    if (!profile?.user_id) return;

    let cancelled = false;
    runOnboardingOrchestrator({
      profile,
      onProgress: (p) => {
        if (!cancelled) setProgress(p);
      },
    })
      .then(async () => {
        if (cancelled) return;
        const { data: freshRow } = await supabase
          .from("profiles")
          .select("onboarding_state")
          .eq("user_id", profile.user_id)
          .maybeSingle();
        if (cancelled) return;
        if (freshRow?.onboarding_state === "ready") {
          await refreshProfile();
          if (!cancelled) {
            try {
              const brief = await downloadJson<CoachLlmBrief>(
                quadernoPath(profile.user_id, "coach_brief.json")
              );
              if (!cancelled) setReadyBrief(brief);
            } catch {
              if (!cancelled) setReadyBrief(null);
            }
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.user_id]);

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
    />
  );
}
