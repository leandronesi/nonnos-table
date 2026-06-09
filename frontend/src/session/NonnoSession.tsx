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
import type { PositionRow } from "../types";
import { toPositionRow } from "./fromCadute";
import { writeEntry, hasEntryToday } from "./journal";
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


const SALUTO_PHRASES = [
  "Hai visto la posizione, ci hai giocato. Domani riprendiamo da dove hai lasciato.",
  "Bene. Oggi hai guardato dove eri. Domani vediamo se ci torna quella stessa struttura.",
  "Oooh. Hai rivisto, hai giocato. Ci siamo. Domani un'altra.",
  "Bene cosi. Quella posizione adesso la riconosci. Torna domani.",
  "Hai fermato la mano una volta. Ricordatelo domani quando ci ritrovi quella struttura.",
];

function pickIdx<T>(arr: T[], n: number): T {
  return arr[n % arr.length];
}

// ---------------------------------------------------------------------------
// Intro builders — frasi Nonno contestualizzate coi dati Maia/clock
// ---------------------------------------------------------------------------

function buildAiutoIntroLines(pos: PositionRow): string[] {
  const p = pos.p_maia_mine_top;
  if (p != null && p > 0 && p <= 0.34) {
    const n = Math.max(3, Math.round(1 / p));
    return [`La trova solo 1 su ${n} al tuo livello. La casa di partenza e' evidenziata. Muovi da li'.`];
  }
  return ["Hai visto. Adesso proviamo insieme. La casa di partenza e' evidenziata in oro. Muovi da li'."];
}

function buildDaSoloIntroLines(pos: PositionRow): string[] {
  const s = pos.spent_seconds;
  if (s != null && s > 0) {
    return [`Stavolta niente evidenziazione. In partita hai scelto in ${Math.max(1, Math.round(s))} secondi. Prenditi il tempo.`];
  }
  return ["Stavolta da solo, niente casa evidenziata. Calma: guarda prima, poi muovi."];
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
// Phase marks — senso-di-luogo, NON progress bar.
//
// Il rito si attraversa, non si "completa a percentuale" (lista del NO: niente
// progress-bar di sessione, DESIGN.md §6: l'unica continuita' e' la memoria di
// Nonno). Quindi: 4 segni di cui UNO acceso (la fase corrente). Niente spunta
// verde di "fase completata", niente conteggio "N/4". Le fasi gia' attraversate
// restano un segno tenue neutro, non un trofeo.
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

  return (
    <>
      {/* Desktop: 4 labels in a row, only the current one lit */}
      <div className="hidden lg:flex items-center gap-0" aria-label="Fasi della sessione">
        {visible.map((ph, i) => {
          const active = ph === current;
          return (
            <div key={ph} className="flex items-center">
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0.25rem 0.75rem",
                  borderRadius: "999px",
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-mono)",
                  fontWeight: active ? 700 : 500,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  transition: "background 180ms var(--ease-out), color 180ms var(--ease-out)",
                  background: active ? "rgba(124,92,255,0.18)" : "transparent",
                  color: active ? "var(--color-brand-soft)" : "var(--color-faint)",
                  border: active ? "1px solid rgba(124,92,255,0.4)" : "1px solid transparent",
                }}
              >
                {PHASE_LABELS[ph]}
              </div>
              {i < visible.length - 1 && (
                <div
                  style={{
                    width: "1.5rem",
                    height: "1px",
                    background: "var(--color-line)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: 4 dots, only the current one lit + the current phase label */}
      <div
        className="flex lg:hidden items-center gap-2"
        aria-label={`Fase: ${PHASE_LABELS[current]}`}
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {/* Dot indicators — one lit, the rest faint. No "done" colour. */}
        <div className="flex items-center gap-1">
          {visible.map((ph) => {
            const active = ph === current;
            return (
              <div
                key={ph}
                style={{
                  width: active ? "1.25rem" : "0.45rem",
                  height: "0.45rem",
                  borderRadius: "999px",
                  background: active ? "var(--color-brand-soft)" : "var(--color-faint)",
                  transition: "width 200ms var(--ease-out), background 200ms var(--ease-out)",
                }}
                aria-hidden="true"
              />
            );
          })}
        </div>
        {/* Current phase label — no "N/4" count */}
        <span style={{
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-brand-soft)",
        }}>
          {PHASE_LABELS[current]}
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

function Saluto({
  totalPositions,
  dominantMotif,
  onClose,
}: {
  totalPositions: number;
  dominantMotif: string | null;
  onClose: () => void;
}) {
  // Name the anchor we sat on today, when we have it: reinforces the continuous
  // memory at zero cost. No invented theme: fall back to the generic close.
  const phrase = dominantMotif
    ? `Oggi abbiamo guardato ${dominantMotif}. Domani riprendiamo da li'.`
    : pickIdx(SALUTO_PHRASES, totalPositions);
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
  // The anchor we sat on today, computed at session completion. Used by the
  // close screen so Nonno names it ("Oggi abbiamo guardato X."). null = unknown.
  const [dominantMotif, setDominantMotif] = useState<string | null>(null);

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
    // Collect the dominant motif/anchor label across the positions reviewed.
    // Use the most frequent motif_label_it (or motif) among the session positions.
    // Computed on every completion so the close screen can name it, even on a
    // second session of the day (when the journal entry is skipped).
    const motifCounts = new Map<string, number>();
    for (const pos of positions) {
      const label = pos.motif_label_it ?? pos.motif ?? null;
      if (label) motifCounts.set(label, (motifCounts.get(label) ?? 0) + 1);
    }
    let motif: string | null = null;
    let maxCount = 0;
    for (const [label, cnt] of motifCounts.entries()) {
      if (cnt > maxCount) { maxCount = cnt; motif = label; }
    }
    setDominantMotif(motif);

    // Write journal entry only once, only on full completion (not on early exit).
    if (!hasEntryToday("session_done")) {
      const body = motif
        ? `Ci siamo seduti su "${motif}". Hai rivisto i momenti, poi hai giocato.`
        : "Ci siamo seduti, abbiamo rivisto i tuoi momenti e giocato una partita.";

      writeEntry({
        kind: "session_done",
        body,
        meta: {
          positions: positions.length,
          ...(motif ? { dominant_motif: motif } : {}),
        },
      });
    }
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
            {/* Short bridge only: the data-rich line lives inside the puzzle voice */}
            <PhaseIntro text="Visto? Adesso proviamo insieme." />
            <PositionPuzzle
              key={`aiuto-${guided.game_id}-${guided.ply}`}
              position={guided}
              patternLabel={patternLabel}
              withHint={true}
              introLines={buildAiutoIntroLines(guided)}
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
            <PhaseIntro text="Bene. Adesso da solo." />
            <PositionPuzzle
              key={`da-solo-${drill.game_id}-${drill.ply}`}
              position={drill}
              patternLabel={drillPatternLabel}
              withHint={false}
              introLines={buildDaSoloIntroLines(drill)}
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
                Hai visto la posizione due volte. Ora giocala.
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
          <Saluto
            totalPositions={positions.length}
            dominantMotif={dominantMotif}
            onClose={onClose}
          />
        )}

      </div>
    </div>
  );
}
