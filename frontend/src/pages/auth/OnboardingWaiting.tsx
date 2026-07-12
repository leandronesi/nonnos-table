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
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { supabase } from "../../auth/supabaseClient";
import type { GoalTimeClass, ProfileRow } from "../../auth/db.types";
import { downloadJson, quadernoPath } from "../../auth/storage";
import { useOnboardingRun } from "../../pipeline/OnboardingRunContext";
import { isAnalyzedTimeClass } from "../../pipeline/config";
import { IncontroScene, type CoachLlmBrief } from "./IncontroScene";
import { tr } from "../../i18n/lang";

function LegacyGoalRecovery({
  profile,
  onRecovered,
  onExit,
}: {
  profile: ProfileRow;
  onRecovered: () => Promise<void>;
  onExit: () => void;
}) {
  const [saving, setSaving] = useState<GoalTimeClass | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function choose(timeClass: GoalTimeClass): Promise<void> {
    if (saving) return;
    setSaving(timeClass);
    setSaveError(null);
    const { data, error } = await supabase.rpc("recover_legacy_goal_time_class", {
      p_goal_time_class: timeClass,
    });
    if (error || data !== true) {
      console.warn("[onboarding] legacy goal recovery failed", error?.message ?? "not_applied");
      setSaveError(tr(
        "Non sono riuscito a salvare la nuova cadenza. Riprova tra poco.",
        "I could not save the new time control. Try again in a moment.",
      ));
      setSaving(null);
      return;
    }
    await onRecovered();
  }

  return (
    <div style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: "1.5rem", background: "var(--color-bg)" }}>
      <div className="surface surface-padded" style={{ width: "100%", maxWidth: "34rem" }}>
        <div className="label-eyebrow text-[color:var(--color-brand-soft)]">
          {tr("Scelta richiesta", "Choice required")}
        </div>
        <h1 className="display-small mt-2">
          {tr("Scegli rapid o blitz", "Choose rapid or blitz")}
        </h1>
        <p className="mt-4 text-[color:var(--color-text-soft)]" style={{ lineHeight: 1.65 }}>
          {tr(
            `Il vecchio profilo usava la cadenza "${profile.goal_time_class}", che questa versione non analizza. Non la sostituisco da solo: scegli la cadenza Chess.com con cui vuoi ripartire.`,
            `The old profile used the "${profile.goal_time_class}" time control, which this version does not analyze. I will not replace it automatically: choose the Chess.com time control you want to use.`,
          )}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {(["rapid", "blitz"] as GoalTimeClass[]).map((timeClass) => (
            <button
              key={timeClass}
              type="button"
              className="btn btn-primary"
              disabled={saving !== null}
              onClick={() => void choose(timeClass)}
            >
              {saving === timeClass ? tr("Salvo...", "Saving...") : timeClass}
            </button>
          ))}
        </div>
        {saveError && <p className="mt-4 text-rose-300">{saveError}</p>}
        <button type="button" className="btn btn-ghost btn-sm mt-6" onClick={onExit}>
          {tr("Esci dall'account", "Sign out")}
        </button>
      </div>
    </div>
  );
}

export function OnboardingWaiting() {
  const nav = useNavigate();
  const {
    profile,
    profileLoading,
    profileError,
    refreshProfile,
    signOut,
  } = useAuth();
  const { progress, error, firstBatchReady } = useOnboardingRun();

  // undefined = non ancora in stato ready
  // null = brief fallito o non trovato (mostra fallback)
  // CoachLlmBrief = brief caricato
  const [readyBrief, setReadyBrief] = useState<CoachLlmBrief | null | undefined>(undefined);

  // Redirect: utente di ritorno già onboardato (profilo ready, ma firstBatchReady
  // è false perché non ha appena completato l'onboarding in questa sessione).
  useEffect(() => {
    if (!profile) return;
    if (
      isAnalyzedTimeClass(profile.goal_time_class) &&
      profile.onboarding_state === "ready" &&
      !firstBatchReady
    ) {
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

  if (!profile || (profileError && profile.onboarding_state !== "ready")) {
    if (!profile && !profileLoading && !profileError) {
      return <Navigate to="/onboarding" replace />;
    }

    return (
      <div
        style={{
          minHeight: "100svh",
          display: "grid",
          placeItems: "center",
          background: "var(--color-bg, #060814)",
          padding: "1.5rem",
        }}
      >
        <div className="surface surface-padded" style={{ width: "100%", maxWidth: "34rem" }}>
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">
            {profileError
              ? tr("Connessione interrotta", "Connection interrupted")
              : tr("Il tuo profilo", "Your profile")}
          </div>
          <h1 className="display-small mt-2">
            {profileError
              ? tr("Non riesco a recuperare il tuo profilo", "I cannot load your profile")
              : tr("Recupero il tuo profilo", "Loading your profile")}
          </h1>
          <p className="mt-4 text-[color:var(--color-text-soft)]" style={{ lineHeight: 1.65 }} aria-live="polite">
            {profileError
              ? tr(
                "La sessione è ancora attiva e non abbiamo cancellato nulla. Controlla la connessione e riprova.",
                "Your session is still active and nothing was deleted. Check your connection and try again.",
              )
              : tr(
                "Aspetto una risposta. Se non arriva, tra pochi secondi potrai riprovare.",
                "I am waiting for a response. If it does not arrive, you can retry in a few seconds.",
              )}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {profileError && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={profileLoading}
                onClick={() => void refreshProfile()}
              >
                {profileLoading ? tr("Riprovo...", "Retrying...") : tr("Riprova", "Try again")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void signOut()}
            >
              {tr("Esci dall'account", "Sign out")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAnalyzedTimeClass(profile.goal_time_class)) {
    return (
      <LegacyGoalRecovery
        profile={profile}
        onRecovered={refreshProfile}
        onExit={() => void signOut()}
      />
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
      username={profile.chess_com_username || undefined}
      tcLabel={profile.goal_time_class || undefined}
      // currentRating is not stored in ProfileRow — falls back to no-data phrase
    />
  );
}
