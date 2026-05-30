/**
 * OnboardingWaiting — pagina che fa partire l'orchestratore client-side e
 * mostra il progresso in tempo reale.
 *
 * Reentrant: se l'utente chiude e riapre, riprende da `ingest_jobs.status`.
 *
 * LOGICA INVARIATA: runOnboardingOrchestrator + listener onProgress + effetti/ref/deps
 * identici all'originale (bug del loop "Mi preparo" gia' risolto, NON reintrodotto).
 * Questo file tocca solo presentazione.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { supabase } from "../../auth/supabaseClient";
import { AuthShell } from "./AuthShell";
import { runOnboardingOrchestrator, type OrchestratorProgress } from "../../pipeline/orchestrator";

// Voce calma per ogni fase del rituale
const PHASE_LABEL: Record<OrchestratorProgress["phase"], string> = {
  pending:   "Mi preparo…",
  ingesting: "Scarico le tue partite",
  analyzing: "Le guardo con Stockfish",
  coaching:  "Apparecchio il Tavolo",
  ready:     "Pronto",
  error:     "Mi sono inceppato",
};

// Nota narrativa per le fasi piu' lunghe
const PHASE_NOTE: Partial<Record<OrchestratorProgress["phase"], string>> = {
  analyzing:
    "Stockfish gira nel tuo browser. Ci vuole qualche minuto: non chiudere la pagina.",
  coaching:
    "Confronto le tue posizioni con chi vuoi diventare. Il primo giro scarica circa 44 MB del modello (poi resta in cache).",
};

export function OnboardingWaiting() {
  const nav = useNavigate();
  const { profile, refreshProfile, signOut } = useAuth();
  const [progress, setProgress] = useState<OrchestratorProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // CRITICO: effetto identico all'originale — deps su [profile?.user_id] per non
  // reintrodurre il bug del loop "Mi preparo".
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
          if (!cancelled) nav("/", { replace: true });
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
      <AuthShell title="Carico…">
        <p style={{ fontSize: "0.875rem", color: "var(--color-muted)" }}>
          Recupero il tuo profilo.
        </p>
      </AuthShell>
    );
  }

  const phase = progress?.phase ?? "pending";
  const ratio =
    progress && progress.gamesTotal > 0
      ? Math.min(1, progress.gamesDone / Math.max(1, progress.gamesTotal))
      : phase === "ingesting" && progress && progress.monthsTotal > 0
      ? progress.monthsDone / progress.monthsTotal
      : 0;

  const pct = Math.round(ratio * 100);
  const note = PHASE_NOTE[phase];
  const isError = phase === "error";
  const isCoaching = phase === "coaching";

  return (
    <AuthShell
      title="Nonno sta sistemando la scacchiera."
      subtitle="Puoi chiudere questa pagina e tornare quando vuoi: riprendo da dove sono."
    >
      <div style={{ display: "grid", gap: "1.75rem" }}>

        {/* Fase attuale — narrata come un gesto */}
        <div>
          <div
            className="tt-eyebrow tt-muted"
            style={{ marginBottom: "0.625rem" }}
          >
            In questo momento
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "1.0625rem",
              color: isError ? "var(--color-danger)" : "var(--color-text)",
              lineHeight: 1.3,
            }}
          >
            {PHASE_LABEL[phase]}
          </div>
        </div>

        {/* Barra di progresso */}
        <div>
          <div
            style={{
              height: "4px",
              borderRadius: "999px",
              background: "var(--color-surface-3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: "999px",
                background: "var(--color-brand)",
                width: isCoaching ? "100%" : `${pct}%`,
                transition: "width 400ms cubic-bezier(0.23,1,0.32,1)",
                animation: isCoaching ? "pulseGlow 2s ease-in-out infinite" : "none",
              }}
            />
          </div>

          {/* Label sotto la barra */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "0.5rem",
            }}
          >
            {isCoaching ? (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.6875rem",
                  color: "var(--color-muted)",
                }}
              >
                {progress?.message ?? "Quasi pronto: preparo i numeri."}
              </span>
            ) : (
              <>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.6875rem",
                    color: "var(--color-muted)",
                  }}
                >
                  {progress?.gamesDone ?? 0} / {progress?.gamesTotal ?? "?"} partite
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.6875rem",
                    color: pct > 0 ? "var(--color-text-soft)" : "var(--color-faint)",
                  }}
                >
                  {pct > 0 ? `${pct}%` : ""}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Nota contestuale per fase */}
        {note ? (
          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-text-soft)",
              lineHeight: 1.6,
              margin: 0,
              padding: "0.875rem",
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-line)",
              borderRadius: "8px",
            }}
          >
            {note}
          </p>
        ) : null}

        {/* Mesi scaricati (fase ingesting) */}
        {phase === "ingesting" && progress && progress.monthsTotal > 0 ? (
          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-text-soft)",
              margin: 0,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--color-text)",
              }}
            >
              {progress.monthsDone}/{progress.monthsTotal}
            </span>{" "}
            mesi scaricati da Chess.com.
          </p>
        ) : null}

        {/* Errore */}
        {error ? (
          <div
            style={{
              padding: "0.875rem",
              background: "rgba(244,63,94,0.08)",
              border: "1px solid rgba(244,63,94,0.22)",
              borderRadius: "8px",
            }}
          >
            <p
              style={{
                fontSize: "0.8125rem",
                color: "var(--color-danger)",
                margin: "0 0 0.75rem",
                lineHeight: 1.5,
              }}
            >
              {error}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-ghost btn-sm"
            >
              Riprova
            </button>
          </div>
        ) : null}

        {/* Esci */}
        <div
          style={{
            paddingTop: "0.25rem",
            borderTop: "1px solid var(--color-line)",
          }}
        >
          <button
            onClick={() => void signOut()}
            className="btn btn-ghost btn-sm"
          >
            Esci dall'account
          </button>
        </div>

      </div>
    </AuthShell>
  );
}
