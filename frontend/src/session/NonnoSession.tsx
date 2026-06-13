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

import { useEffect, useRef, useState } from "react";
import type { PositionExample } from "../pipeline/aggregate";
import type { PlayResult } from "./store";
import type { PositionRow } from "../types";
import { toPositionRow } from "./fromCadute";
import { writeEntry, hasEntryToday } from "./journal";
import { MomentReview } from "./MomentReview";
import { PositionPuzzle } from "./WarmupGuidato";
import { PlayStep } from "./PlayStep";
import { navigateWithTransition, prefersReducedMotion } from "../lib/motion";
import { resetBoardSceneRitual } from "../components/BoardScene";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = "guardo" | "aiuto" | "da-solo" | "partita" | "saluto";

interface Props {
  cadute: PositionExample[];
  targetRating: number;
  currentRating: number | null;
  onClose: () => void;
  /**
   * When true, the first MomentReview's BoardScene starts already risen.
   * Set from Sessione when the user arrives via a View Transition morph from
   * the Tavolo: the board was already carried as a shared element, a second
   * rise would be a double entrance. The morph counts as the session's
   * sit-down, so later phases (aiuto, da-solo, partita) stay already up too.
   */
  viaMorph?: boolean;
}

// ---------------------------------------------------------------------------
// Phrase banks — voce Nonno, brevi, 2 varianti
// ---------------------------------------------------------------------------


const SALUTO_PHRASES = [
  "Hai visto la posizione, ci hai giocato. Domani riprendiamo da dove hai lasciato.",
  "Bene. Oggi hai guardato dove eri. Domani vediamo se ci torna quella stessa struttura.",
  "Hai rivisto, hai giocato. Ci siamo. Domani un'altra.",
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

// ---------------------------------------------------------------------------
// PhaseThread — ink-line with 4 stations.
//
// The filled portion (inchiostro pieno) tracks the CURRENT position: 0%, 33%,
// 66%, or 100%.  The remainder is dashed (tratteggio).  A CSS overlay div
// transitions its width with ease-ink (600ms) so the fill "draws itself in".
// ---------------------------------------------------------------------------

const THREAD_PHASES: Phase[] = ["guardo", "aiuto", "da-solo", "partita"];

// Station positions as % along the track (0=left, 100=right).
const STATION_PCT: Record<Phase, number> = {
  "guardo":   0,
  "aiuto":    33,
  "da-solo":  66,
  "partita":  100,
  "saluto":   100,
};

function PhaseThread({ current }: { current: Phase }) {
  const fillPct = STATION_PCT[current];
  // "saluto" is past the last station: indexOf is -1, treat as beyond the end
  // so every station reads as done and the SR label says the ritual is over.
  const rawIdx = THREAD_PHASES.indexOf(current);
  const currentIdx = rawIdx === -1 ? THREAD_PHASES.length : rawIdx;
  const srLabel =
    rawIdx === -1
      ? `Sessione completata: ${PHASE_LABELS[current]}`
      : `Fase ${rawIdx + 1} di 4: ${PHASE_LABELS[current]}`;

  return (
    <div
      aria-label={srLabel}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fillPct}
      style={{
        display: "flex",
        alignItems: "center",
        flexDirection: "column",
        gap: "0.35rem",
        flex: 1,
        maxWidth: "22rem",
        minWidth: "10rem",
      }}
    >
      {/* Track + stations */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "0.75rem",
          display: "flex",
          alignItems: "center",
        }}
        aria-hidden="true"
      >
        {/* Base dashed track — the "future" part */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: "2px",
            backgroundImage: "repeating-linear-gradient(90deg, var(--color-line-strong) 0 4px, transparent 4px 10px)",
            opacity: 0.7,
          }}
        />
        {/* Filled overlay — the "past + current" part, animates on phase change */}
        <div
          style={{
            position: "absolute",
            left: 0,
            height: "2px",
            width: `${fillPct}%`,
            background: "var(--color-brand-soft)",
            opacity: 0.7,
            transition: prefersReducedMotion()
              ? "none"
              : "width 600ms var(--ease-ink)",
          }}
        />
        {/* Stations */}
        {THREAD_PHASES.map((ph) => {
          const pctPos = STATION_PCT[ph];
          const isCurrent = ph === current;
          const isPast = THREAD_PHASES.indexOf(ph) < currentIdx;

          return (
            <div
              key={ph}
              title={PHASE_LABELS[ph]}
              style={{
                position: "absolute",
                left: `${pctPos}%`,
                transform: "translateX(-50%)",
                width: isCurrent ? "8px" : "6px",
                height: isCurrent ? "8px" : "6px",
                borderRadius: "999px",
                background: isPast || isCurrent
                  ? "var(--color-brand-soft)"
                  : "transparent",
                border: isPast || isCurrent
                  ? "none"
                  : `1px solid var(--color-line-strong)`,
                transition: prefersReducedMotion()
                  ? "none"
                  : "width 300ms var(--ease-out), height 300ms var(--ease-out), background 300ms var(--ease-out)",
                flexShrink: 0,
                zIndex: 1,
                // station labels for the SR label are on the parent
              }}
              aria-hidden="true"
            />
          );
        })}
      </div>

      {/* Current phase label (eyebrow, below the thread) */}
      <span
        className="tt-eyebrow"
        style={{
          color: "var(--color-brand-soft)",
          letterSpacing: "0.1em",
        }}
      >
        {PHASE_LABELS[current]}
      </span>
    </div>
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
      <PhaseThread current={phase} />
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
  // Click anywhere to reveal everything immediately (skip delays).
  const [revealed, setRevealedState] = useState(prefersReducedMotion());
  // Overlay visible on mount; phrase/CTA settle in with delays.
  // Reduced motion: the curtain is part of the scene, not a transition — shown at once.
  const [overlayIn, setOverlayIn] = useState(prefersReducedMotion());
  const [phraseIn, setPhraseIn] = useState(prefersReducedMotion());
  const [ctaIn, setCtaIn] = useState(prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) return;
    // Overlay fades in immediately
    const t0 = setTimeout(() => setOverlayIn(true), 10);
    // Phrase settles at 400ms
    const t1 = setTimeout(() => setPhraseIn(true), 400);
    // CTA settles at 1000ms
    const t2 = setTimeout(() => setCtaIn(true), 1000);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, []);

  function handleReveal() {
    setRevealedState(true);
    setOverlayIn(true);
    setPhraseIn(true);
    setCtaIn(true);
  }

  const phrase = dominantMotif
    ? `Oggi abbiamo guardato ${dominantMotif}. Domani riprendiamo da li'.`
    : pickIdx(SALUTO_PHRASES, totalPositions);

  // When revealed, all delays are bypassed (transition still runs but from
  // already-set state so it's instant in practice).
  const phraseVisible = revealed || phraseIn;
  const ctaVisible = revealed || ctaIn;

  return (
    <>
      {/* Curtain overlay — scuro, sotto il contenuto del saluto */}
      <div
        aria-hidden="true"
        onClick={handleReveal}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          zIndex: 0,
          opacity: overlayIn || revealed ? 1 : 0,
          transition: prefersReducedMotion()
            ? "none"
            : "opacity 600ms ease-out",
          pointerEvents: "auto",
        }}
      />

      {/* Saluto content — above the overlay */}
      <div
        className="max-w-lg mx-auto text-center"
        style={{
          padding: "5rem 1.5rem 6rem",
          position: "relative",
          zIndex: 1,
          cursor: ctaVisible ? "default" : "pointer",
        }}
        onClick={!ctaVisible ? handleReveal : undefined}
      >
        <div className="tt-eyebrow" style={{ marginBottom: "1.5rem" }}>
          Nonno
        </div>
        <p
          style={{
            fontFamily: "var(--font-voice)",
            fontWeight: 500,
            fontSize: "clamp(1.6rem, 4vw, 2.2rem)",
            lineHeight: 1.35,
            color: "var(--color-text)",
            margin: "0 auto 2.5rem",
            textAlign: "center",
            opacity: phraseVisible ? 1 : 0,
            transform: phraseVisible ? "translateY(0)" : "translateY(8px)",
            transition: prefersReducedMotion()
              ? "none"
              : "opacity 600ms var(--ease-settle), transform 600ms var(--ease-settle)",
          }}
        >
          {phrase}
        </p>
        <div
          style={{
            opacity: ctaVisible ? 1 : 0,
            transform: ctaVisible ? "translateY(0)" : "translateY(8px)",
            // Invisible must mean untouchable: a hidden CTA that still catches
            // a tap would close the session before the Nonno finishes speaking.
            pointerEvents: ctaVisible ? "auto" : "none",
            transition: prefersReducedMotion()
              ? "none"
              : "opacity 600ms var(--ease-settle), transform 600ms var(--ease-settle)",
          }}
        >
          <button onClick={onClose} className="btn btn-primary btn-lg">
            Vai e respira
          </button>
        </div>
      </div>
    </>
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

export function NonnoSession({ cadute, targetRating, currentRating, onClose, viaMorph = false }: Props) {
  // Reset the once-per-session board rise so the sit-down ritual plays once on
  // entry, then never again until the next session. Done during render (before
  // any child BoardScene mounts, so the first board reads a fresh flag) and
  // guarded to run a single time per session mount.
  const ritualResetRef = useRef(false);
  if (!ritualResetRef.current) {
    ritualResetRef.current = true;
    resetBoardSceneRitual();
  }

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
    navigateWithTransition(() => {
      setPhase((current) => {
        const idx = PHASE_ORDER.indexOf(current);
        if (idx < PHASE_ORDER.length - 1) return PHASE_ORDER[idx + 1];
        return current;
      });
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
    navigateWithTransition(() => setPhase("saluto"));
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
          <div key="phase-guardo" className="settle-in">
            <MomentReview
              position={review}
              index={0}
              total={1}
              maiaLevel={targetRating}
              onNext={advance}
              startRisen={viaMorph}
            />
          </div>
        )}

        {/* Fase 2 — AIUTO */}
        {phase === "aiuto" && (
          <div key="phase-aiuto" className="settle-in">
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
          <div key="phase-da-solo" className="settle-in">
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
          <div key="phase-partita" className="settle-in">
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
          <div key="phase-saluto" className="settle-in" style={{ position: "relative" }}>
            <Saluto
              totalPositions={positions.length}
              dominantMotif={dominantMotif}
              onClose={onClose}
            />
          </div>
        )}

      </div>
    </div>
  );
}
