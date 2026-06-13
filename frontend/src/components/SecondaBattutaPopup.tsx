/**
 * SecondaBattutaPopup — seconda battuta di Nonno al completamento del background.
 *
 * Appare quando backgroundDone === true (coaching su 100 partite completato).
 * Mostra un unico pannello centrato con la voce di Nonno e una CTA che lo chiude.
 * NON naviga, NON reloada. Risiede come sibling di <Routes> in App.tsx.
 *
 * Voce: nonno-voice (asciutto, 2a persona, niente em-dash, niente emoji).
 */

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { downloadJson, quadernoPath } from "../auth/storage";
import { tr } from "../i18n/lang";

interface CoachBrief {
  voice_message?: string;
  one_line_diagnosis?: string;
}

function getFallbackText(): string {
  return tr(
    "Ho guardato anche il resto. C'e' un'altra cosa che voglio dirti, quando sei pronto a sederti.",
    "I looked at the rest. There is something else I want to tell you, when you are ready to sit down.",
  );
}

export function SecondaBattutaPopup() {
  const { user } = useAuth();
  const { backgroundDone } = useOnboardingRun();

  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState<string>(() => getFallbackText());
  const ctaRef = useRef<HTMLButtonElement>(null);

  // Carica il coach_brief aggiornato (100 partite) per il voice_message.
  useEffect(() => {
    if (!backgroundDone || !user) return;
    let cancelled = false;
    (async () => {
      const brief = await downloadJson<CoachBrief>(
        quadernoPath(user.id, "coach_brief.json")
      );
      if (cancelled) return;
      const msg = brief?.voice_message?.trim();
      if (msg) setText(msg);
    })();
    return () => {
      cancelled = true;
    };
  }, [backgroundDone, user]);

  // Animazione ingresso: mostriamo il DOM subito (opacity 0), poi triggeriamo
  // la transizione al frame successivo.
  useEffect(() => {
    if (!backgroundDone || dismissed) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [backgroundDone, dismissed]);

  // Focus sulla CTA per accessibilita'.
  useEffect(() => {
    if (visible && !dismissed) {
      ctaRef.current?.focus();
    }
  }, [visible, dismissed]);

  if (!backgroundDone || dismissed) return null;

  return (
    /* Overlay */
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr("Nonno ha qualcosa da dirti", "Nonno has something to tell you")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "clamp(1rem, 4vw, 2rem)",
        background: "rgba(0,0,0,0.45)",
        opacity: visible ? 1 : 0,
        transition: "opacity 300ms cubic-bezier(0.23,1,0.32,1)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {/* Pannello */}
      <div
        style={{
          width: "100%",
          maxWidth: "28rem",
          background: "var(--color-surface-table, var(--color-surface-2, #1a1a2e))",
          border: "1px solid var(--color-line-ink, var(--color-line))",
          borderRadius: "16px",
          padding: "clamp(1.25rem, 5vw, 2rem)",
          transform: visible ? "translateY(0) scale(1)" : "translateY(16px) scale(0.96)",
          transition: "transform 300ms cubic-bezier(0.23,1,0.32,1), opacity 300ms cubic-bezier(0.23,1,0.32,1)",
          opacity: visible ? 1 : 0,
        }}
      >
        {/* Eyebrow */}
        <div
          className="tt-eyebrow"
          style={{
            color: "var(--color-brand-soft)",
            marginBottom: "0.875rem",
            fontSize: "0.7rem",
            letterSpacing: "0.08em",
          }}
        >
          {tr("Nonno ha finito di guardare", "Nonno is done.")}
        </div>

        {/* Testo voce di Nonno */}
        <p
          style={{
            fontSize: "clamp(0.95rem, 2.5vw, 1.05rem)",
            lineHeight: 1.65,
            color: "var(--color-text)",
            margin: "0 0 1.5rem 0",
            fontWeight: 400,
          }}
        >
          {text}
        </p>

        {/* CTA unica */}
        <button
          ref={ctaRef}
          onClick={() => setDismissed(true)}
          style={{
            display: "block",
            width: "100%",
            padding: "0.75rem 1.25rem",
            borderRadius: "10px",
            border: "1px solid color-mix(in srgb, var(--color-brand-soft) 40%, transparent)",
            background: "color-mix(in srgb, var(--color-brand-soft) 14%, transparent)",
            color: "var(--color-brand-soft)",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "background 180ms ease, border-color 180ms ease",
            textAlign: "center",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "color-mix(in srgb, var(--color-brand-soft) 22%, transparent)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "color-mix(in srgb, var(--color-brand-soft) 14%, transparent)";
          }}
        >
          {tr("Va bene, fammi vedere", "Good. Show me.")}
        </button>
      </div>
    </div>
  );
}
