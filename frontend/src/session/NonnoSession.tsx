/**
 * NonnoSession.tsx — Sessione a 4 fasi come da Manifesto e pitch 03-prova.html.
 *
 * Flusso: GUARDO (review passivo) -> AIUTO (puzzle con hint) -> DA SOLO (drill) -> PARTITA -> SALUTO
 *
 * Robustezza a 0/1/2/3+ posizioni:
 *   - 0 posizioni: EmptyState pulito.
 *   - 1 posizione: la stessa viene riusata per review/guided/drill/play.
 *   - 2 posizioni: review=0, guided=1, drill=1, play=fen[0].
 *   - 3+ posizioni: review=0, guided=1, drill=2, play=fen[0].
 *
 * Design: board-centrico, calmo, UNA azione per fase, Nonno presente in ogni fase.
 * Token: tt-nonno, sess-*, DESIGN.md compliant (flat, no card-dentro-card).
 */

import { useEffect, useState } from "react";
import type { PositionExample } from "../pipeline/aggregate";
import type { PlayResult } from "./store";
import { toPositionRow } from "./fromCadute";
import { MomentReview } from "./MomentReview";
import { PositionPuzzle } from "./WarmupGuidato";
import { PlayStep } from "./PlayStep";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = "guardo" | "aiuto" | "da-solo" | "partita" | "saluto";

interface Props {
  cadute: PositionExample[];
  targetRating: number;
  currentRating: number | null;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Phrase banks — voce Nonno, brevi, 2 varianti
// ---------------------------------------------------------------------------

const AIUTO_INTROS = [
  "Adesso ti aiuto io. La casa di partenza e' evidenziata. Trova dove va.",
  "Ci sono. Muovi il pezzo dalla casa dorata. Trova la mossa.",
];

const DA_SOLO_INTROS = [
  "Adesso tocca a te. Senza aiuti. Pensa, poi muovi.",
  "Niente suggerimenti questa volta. Calma e attenzione.",
];

const SALUTO_PHRASES = [
  "Bravo. Hai guardato le tue mosse in faccia. Questo si fa.",
  "Bene. Adesso sai dove eri. Domani vediamo come va.",
  "Oooh. Hai rivisto, hai giocato. Per oggi basta.",
  "Bene cosi. Torna domani con le stesse mosse in testa.",
  "Hai fermato la mano almeno una volta oggi. Bene cosi.",
];

function pickIdx<T>(arr: T[], n: number): T {
  return arr[n % arr.length];
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "var(--color-bg)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Sessione"
    >
      <div style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: "14px",
        padding: "2.5rem 2rem",
        maxWidth: "32rem",
        textAlign: "center",
      }}>
        <div className="tt-eyebrow tt-muted" style={{ marginBottom: "0.75rem" }}>
          Sessione
        </div>
        <h2 style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "1.5rem",
          color: "var(--color-text)",
          margin: "0 0 0.75rem",
        }}>
          Ancora niente da rivedere
        </h2>
        <p style={{ color: "var(--color-text-soft)", lineHeight: 1.6, marginBottom: "1.5rem" }}>
          Torna dopo l&apos;analisi per avere momenti da rivedere insieme.
        </p>
        <button onClick={onClose} className="btn btn-primary">
          Torna al Tavolo
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress strip — 4 fasi visibili, niente "saluto"
// ---------------------------------------------------------------------------

const PHASE_ORDER: Phase[] = ["guardo", "aiuto", "da-solo", "partita", "saluto"];

const PHASE_LABELS: Record<Phase, string> = {
  "guardo":  "Guardo",
  "aiuto":   "Aiuto",
  "da-solo": "Da solo",
  "partita": "Partita",
  "saluto":  "Fine",
};

function PhasePills({ current }: { current: Phase }) {
  const visible: Phase[] = ["guardo", "aiuto", "da-solo", "partita"];
  const currentIdx = PHASE_ORDER.indexOf(current);
  // 1-based number among the 4 visible phases (saluto is hidden)
  const visibleIndex = visible.indexOf(current);
  const phaseNumber = visibleIndex >= 0 ? visibleIndex + 1 : currentIdx + 1;

  return (
    <>
      {/* Desktop: 4 pills in a row */}
      <div className="hidden lg:flex items-center gap-0" aria-label="Fasi della sessione">
        {visible.map((ph, i) => {
          const phIdx = PHASE_ORDER.indexOf(ph);
          const done   = phIdx < currentIdx;
          const active = ph === current;
          return (
            <div key={ph} className="flex items-center">
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  padding: "0.25rem 0.75rem",
                  borderRadius: "999px",
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-mono)",
                  fontWeight: active ? 700 : 500,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  transition: "background 180ms var(--ease-out), color 180ms var(--ease-out)",
                  background: active
                    ? "rgba(124,92,255,0.18)"
                    : "transparent",
                  color: active
                    ? "var(--color-brand-soft)"
                    : done
                    ? "var(--color-muted)"
                    : "var(--color-faint)",
                  border: active
                    ? "1px solid rgba(124,92,255,0.4)"
                    : "1px solid transparent",
                }}
              >
                {done && (
                  <span style={{ color: "var(--color-ok)", fontSize: "0.6rem" }}>✓</span>
                )}
                {PHASE_LABELS[ph]}
              </div>
              {i < visible.length - 1 && (
                <div
                  style={{
                    width: "1.5rem",
                    height: "1px",
                    background: done ? "var(--color-brand-soft)" : "var(--color-line)",
                    opacity: done ? 0.5 : 1,
                    transition: "background 300ms var(--ease-out)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: compact "Fase N/4 · Label" */}
      <div
        className="flex lg:hidden items-center gap-2"
        aria-label={`Fase ${phaseNumber} di 4: ${PHASE_LABELS[current]}`}
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {/* Dot indicators */}
        <div className="flex items-center gap-1">
          {visible.map((ph) => {
            const phIdx = PHASE_ORDER.indexOf(ph);
            const done   = phIdx < currentIdx;
            const active = ph === current;
            return (
              <div
                key={ph}
                style={{
                  width: active ? "1.25rem" : "0.45rem",
                  height: "0.45rem",
                  borderRadius: "999px",
                  background: active
                    ? "var(--color-brand-soft)"
                    : done
                    ? "var(--color-ok)"
                    : "var(--color-faint)",
                  transition: "width 200ms var(--ease-out), background 200ms var(--ease-out)",
                }}
                aria-hidden="true"
              />
            );
          })}
        </div>
        {/* Current phase label */}
        <span style={{
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-brand-soft)",
        }}>
          {phaseNumber}/{visible.length} · {PHASE_LABELS[current]}
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Header sticky
// ---------------------------------------------------------------------------

function SessionHeader({ phase, onExit }: { phase: Phase; onExit: () => void }) {
  return (
    <div
      className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-[color:var(--color-line)]"
      style={{ background: "var(--header-bg)", backdropFilter: "blur(14px)" }}
    >
      <div className="tt-eyebrow" style={{ minWidth: "4rem" }}>
        Sessione
      </div>
      <PhasePills current={phase} />
      <button
        onClick={onExit}
        className="btn btn-ghost btn-sm"
        aria-label="Esci dalla sessione"
        style={{ minWidth: "4rem", justifyContent: "flex-end" }}
      >
        Esci
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saluto screen — board-centrico, Nonno parla
// ---------------------------------------------------------------------------

function Saluto({ totalPositions, onClose }: { totalPositions: number; onClose: () => void }) {
  const phrase = pickIdx(SALUTO_PHRASES, totalPositions);
  return (
    <div
      className="max-w-lg mx-auto text-center fade-in"
      style={{ padding: "5rem 1.5rem 6rem" }}
    >
      <div className="tt-eyebrow" style={{ marginBottom: "1.5rem" }}>
        Nonno
      </div>
      <p className="tt-nonno" style={{
        margin: "0 auto 2.5rem",
        paddingLeft: 0,
        borderLeft: "none",
        textAlign: "center",
        fontSize: "clamp(1.4rem, 3.5vw, 1.8rem)",
      }}>
        {phrase}
      </p>
      <button onClick={onClose} className="btn btn-primary btn-lg">
        Vai e respira
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fase AIUTO intro + fase DA SOLO intro — voce Nonno inline
// ---------------------------------------------------------------------------

function PhaseIntro({ text }: { text: string }) {
  return (
    <div
      className="sess-nonno"
      style={{ marginBottom: "1.25rem" }}
      aria-live="polite"
    >
      <span className="who">Nonno</span>
      <p>{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NonnoSession — orchestratore principale
// ---------------------------------------------------------------------------

export function NonnoSession({ cadute, targetRating, currentRating, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("guardo");

  // Escape key exits
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (cadute.length === 0) {
    return <EmptyState onClose={onClose} />;
  }

  const positions = cadute.map((pe, i) => toPositionRow(pe, i));

  const review  = positions[0];
  const guided  = positions[1] ?? positions[0];
  const drill   = positions[2] ?? positions[1] ?? positions[0];
  const playFen = positions[0].fen_before;
  const playColor: "white" | "black" = positions[0].my_color;

  const patternLabel =
    guided.motif_label_it ?? guided.motif ?? "Posizione";

  const drillPatternLabel =
    drill.motif_label_it ?? drill.motif ?? "Posizione";

  function advance() {
    setPhase((current) => {
      const idx = PHASE_ORDER.indexOf(current);
      if (idx < PHASE_ORDER.length - 1) return PHASE_ORDER[idx + 1];
      return current;
    });
  }

  function handlePlayDone(_result: PlayResult) {
    setPhase("saluto");
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-auto"
      style={{ background: "var(--color-bg)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Sessione di revisione"
    >
      <SessionHeader phase={phase} onExit={onClose} />

      <div className="max-w-[1100px] mx-auto px-5 lg:px-10 py-8">

        {/* Fase 1 — GUARDO */}
        {phase === "guardo" && (
          <MomentReview
            key="review-0"
            position={review}
            index={0}
            total={1}
            maiaLevel={targetRating}
            onNext={advance}
          />
        )}

        {/* Fase 2 — AIUTO */}
        {phase === "aiuto" && (
          <div className="fade-in">
            <div className="sess-phase-header">
              <div className="sess-phase-dot">2</div>
              <span className="sess-phase-title">Nonno mi aiuta</span>
            </div>
            <PhaseIntro text={pickIdx(AIUTO_INTROS, positions.length)} />
            <PositionPuzzle
              key={`aiuto-${guided.game_id}-${guided.ply}`}
              position={guided}
              patternLabel={patternLabel}
              withHint={true}
              introLines={AIUTO_INTROS}
              onNext={advance}
            />
          </div>
        )}

        {/* Fase 3 — DA SOLO */}
        {phase === "da-solo" && (
          <div className="fade-in">
            <div className="sess-phase-header">
              <div className="sess-phase-dot">3</div>
              <span className="sess-phase-title">Gioco da solo</span>
            </div>
            <PhaseIntro text={pickIdx(DA_SOLO_INTROS, positions.length)} />
            <PositionPuzzle
              key={`da-solo-${drill.game_id}-${drill.ply}`}
              position={drill}
              patternLabel={drillPatternLabel}
              withHint={false}
              introLines={DA_SOLO_INTROS}
              onNext={advance}
            />
          </div>
        )}

        {/* Fase 4 — PARTITA vs avversario@target */}
        {phase === "partita" && (
          <div className="fade-in">
            <div className="sess-phase-header">
              <div className="sess-phase-dot honey">4</div>
              <span className="sess-phase-title" style={{ color: "var(--color-gold-soft)" }}>
                Rifaccio la partita vs avversario {targetRating}
              </span>
            </div>
            <PlayStep
              startFen={playFen}
              myColor={playColor}
              maiaLevel={targetRating}
              currentRating={currentRating ?? undefined}
              timeClass="rapid"
              onDone={handlePlayDone}
            />
          </div>
        )}

        {/* SALUTO */}
        {phase === "saluto" && (
          <Saluto totalPositions={positions.length} onClose={onClose} />
        )}

      </div>
    </div>
  );
}
