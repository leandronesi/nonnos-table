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

import { useEffect, useRef, useState, type RefObject } from "react";
import type { PositionExample } from "../pipeline/aggregate";
import type { PlayResult } from "./store";
import type { PositionRow } from "../types";
import { toPositionRow } from "./fromCadute";
import { writeEntry, hasEntryToday } from "./journal";
import { MomentReview } from "./MomentReview";
import { PositionPuzzle, type PositionPuzzleVerdictContext } from "./WarmupGuidato";
import { PlayStep } from "./PlayStep";
import { navigateWithTransition, prefersReducedMotion } from "../lib/motion";
import { resetBoardSceneRitual } from "../components/BoardScene";
import { tr, getLang } from "../i18n/lang";
import { reportClientError, trackEvent } from "../lib/telemetry";
import type { AdaptiveSessionSelection, WhyToday } from "./adaptiveSelector";
import { stablePositionId } from "./adaptiveSelector";
import { createEvaluatedAttemptRecorder } from "./attemptRecorder";
import { createPassiveReviewRecorder } from "./passiveReviewHistory";
import { recordVerdict } from "../srs";
import { recordTrainingAttempt } from "../trainingProgress";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionPhase = "guardo" | "aiuto" | "da-solo" | "partita" | "saluto";
type Phase = SessionPhase;

interface Props {
  selection: AdaptiveSessionSelection<PositionExample> | null;
  targetRating: number;
  timeClass: string;
  onClose: () => void;
  /** Stable identity of this selected session, used to dedupe passive views. */
  sessionIdentity: string;
  initialPhase?: SessionPhase;
  onPhaseChange?: (phase: SessionPhase) => void;
  onCompleted?: (result: PlayResult) => void;
  /**
   * When true, the first MomentReview's BoardScene starts already risen.
   * Set from Sessione when the user arrives via a View Transition morph from
   * the Tavolo: the board was already carried as a shared element, a second
   * rise would be a double entrance. The morph counts as the session's
   * sit-down, so later phases (aiuto, da-solo, partita) stay already up too.
   */
  viaMorph?: boolean;
}

const DIALOG_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function dialogFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)].filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && style.pointerEvents !== "none";
  });
}

// ---------------------------------------------------------------------------
// Phrase banks — voce Nonno, brevi, 2 varianti
// SALUTO_PHRASES is a function to avoid module-level string freeze.
// Strings are evaluated at call time so getLang() returns the current language.
// ---------------------------------------------------------------------------

function getSalutoPhrases(): string[] {
  if (getLang() === "en") {
    return [
      "You saw the position, you played it. Tomorrow we pick it up from there.",
      "Good. Today you looked at where you were. Tomorrow we see if that structure comes back.",
      "You reviewed, you played. We are here. Tomorrow another one.",
      "Good. You know that position now. Come back tomorrow.",
      "You stopped your hand once. Remember that tomorrow when you see that structure again.",
    ];
  }
  return [
    "Hai visto la posizione, ci hai giocato. Domani riprendiamo da dove hai lasciato.",
    "Bene. Oggi hai guardato dove eri. Domani vediamo se ci torna quella stessa struttura.",
    "Hai rivisto, hai giocato. Ci siamo. Domani un'altra.",
    "Bene cosi. Quella posizione adesso la riconosci. Torna domani.",
    "Hai fermato la mano una volta. Ricordatelo domani quando ci ritrovi quella struttura.",
  ];
}

function pickIdx<T>(arr: T[], n: number): T {
  return arr[n % arr.length];
}

// ---------------------------------------------------------------------------
// Intro builders — frasi Nonno contestualizzate coi dati Maia/clock
// ---------------------------------------------------------------------------

function buildAiutoIntroLines(pos: PositionRow): string[] {
  if (pos.avoidable_at_current === true) {
    return [
      tr(
        "La policy Maia al livello attuale assegna supporto alle alternative accettabili osservate. E' un segnale relativo: la casa di partenza e' evidenziata, proviamo.",
        "The current-level Maia policy supports the observed acceptable alternatives. It is a relative signal: the starting square is highlighted, so let us try.",
      ),
    ];
  }
  if (pos.target_relevant === true) {
    return [
      tr(
        "Questa posizione e' nel percorso verso il tuo obiettivo. La casa di partenza e' evidenziata: proviamo insieme.",
        "This position is on the path to your target. The starting square is highlighted: let us try it together.",
      ),
    ];
  }
  return [
    tr(
      "Hai visto. Adesso proviamo insieme. La casa di partenza e' evidenziata in oro. Muovi da li'.",
      "Good. Now we try together. The starting square is highlighted in gold. Move from there.",
    ),
  ];
}

function buildDaSoloIntroLines(pos: PositionRow): string[] {
  const s = pos.spent_seconds;
  if (s != null && s > 0) {
    return [
      tr(
        `Stavolta niente evidenziazione. In partita hai scelto in ${Math.max(1, Math.round(s))} secondi. Prenditi il tempo.`,
        `No highlight this time. In the game you moved in ${Math.max(1, Math.round(s))} seconds. Take your time.`,
      ),
    ];
  }
  return [
    tr(
      "Stavolta da solo, niente casa evidenziata. Calma: guarda prima, poi muovi.",
      "On your own now, no highlight. Look first, then move.",
    ),
  ];
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  onClose,
  dialogRef,
}: {
  onClose: () => void;
  dialogRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "var(--color-bg)" }}
      role="dialog"
      aria-modal="true"
      aria-label={tr("Sessione", "Session")}
    >
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: "14px",
          padding: "2.5rem 2rem",
          maxWidth: "32rem",
          textAlign: "center",
        }}
      >
        <div
          className="tt-eyebrow tt-muted"
          style={{ marginBottom: "0.75rem" }}
        >
          {tr("Sessione", "Session")}
        </div>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "1.5rem",
            color: "var(--color-text)",
            margin: "0 0 0.75rem",
          }}
        >
          {tr("Ancora niente da rivedere", "Nothing to review yet")}
        </h2>
        <p
          style={{
            color: "var(--color-text-soft)",
            lineHeight: 1.6,
            marginBottom: "1.5rem",
          }}
        >
          {tr(
            "Torna dopo l'analisi per avere momenti da rivedere insieme.",
            "The picture builds with each game. Come back after your next one.",
          )}
        </p>
        <button onClick={onClose} className="btn btn-primary">
          {tr("Torna al Tavolo", "Back to the Table")}
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

// PHASE_LABELS is a function to avoid module-level string freeze.
function getPhaseLabels(): Record<Phase, string> {
  if (getLang() === "en") {
    return {
      guardo: "I look",
      aiuto: "With help",
      "da-solo": "On my own",
      partita: "Game",
      saluto: "Done",
    };
  }
  return {
    guardo: "Guardo",
    aiuto: "Aiuto",
    "da-solo": "Da solo",
    partita: "Partita",
    saluto: "Fine",
  };
}

const THREAD_PHASES: Phase[] = ["guardo", "aiuto", "da-solo", "partita"];

function PhaseThread({ current }: { current: Phase }) {
  const phaseLabels = getPhaseLabels();
  const rawIdx = THREAD_PHASES.indexOf(current);
  const next = rawIdx >= 0 && rawIdx < THREAD_PHASES.length - 1
    ? THREAD_PHASES[rawIdx + 1]
    : null;
  const srLabel = next
    ? tr(
        `Ora: ${phaseLabels[current]}. Poi: ${phaseLabels[next]}.`,
        `Now: ${phaseLabels[current]}. Next: ${phaseLabels[next]}.`,
      )
    : tr(
        `Ora: ${phaseLabels[current]}.`,
        `Now: ${phaseLabels[current]}.`,
      );

  return (
    <div
      aria-label={srLabel}
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        flexDirection: "column",
        gap: "0.15rem",
        flex: 1,
        maxWidth: "22rem",
        minWidth: 0,
        textAlign: "center",
      }}
    >
      <span
        className="tt-eyebrow"
        style={{
          color: "var(--color-brand-soft)",
          letterSpacing: "0.1em",
        }}
      >
        {tr("Ora", "Now")} · {phaseLabels[current]}
      </span>
      {next && (
        <span style={{ color: "var(--color-faint)", fontSize: "0.7rem", lineHeight: 1.2 }}>
          {tr("Poi", "Next")} · {phaseLabels[next]}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header sticky
// ---------------------------------------------------------------------------

function SessionHeader({
  phase,
  onExit,
}: {
  phase: Phase;
  onExit: () => void;
}) {
  return (
    <div
      className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-[color:var(--color-line)]"
      style={{ background: "var(--header-bg)", backdropFilter: "blur(14px)" }}
    >
      {/* Empty spacer (was a redundant "Session" eyebrow that collided with the
          AppShell brand): keeps the PhaseThread centred between it and Exit. */}
      <div style={{ minWidth: "4rem" }} aria-hidden="true" />
      <PhaseThread current={phase} />
      <button
        onClick={onExit}
        className="btn btn-ghost btn-sm"
        aria-label={tr("Esci dalla sessione", "Exit session")}
        style={{ minWidth: "4rem", justifyContent: "flex-end" }}
      >
        {tr("Esci", "Exit")}
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
  onRepeat,
}: {
  totalPositions: number;
  dominantMotif: string | null;
  onClose: () => void;
  onRepeat: () => void;
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
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  function handleReveal() {
    setRevealedState(true);
    setOverlayIn(true);
    setPhraseIn(true);
    setCtaIn(true);
  }

  const phrase = dominantMotif
    ? tr(
        `Oggi abbiamo guardato ${dominantMotif}. Domani riprendiamo da li'.`,
        `Today we looked at ${dominantMotif}. Tomorrow we pick it up from there.`,
      )
    : pickIdx(getSalutoPhrases(), totalPositions);

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
          transition: prefersReducedMotion() ? "none" : "opacity 600ms ease-out",
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
          <p style={{ margin: "0 auto 1rem", color: "var(--color-text-soft)", fontSize: "0.875rem", lineHeight: 1.55, maxWidth: "30rem" }}>
            {tr(
              "La sessione di oggi e' salvata. Torna domani dal Tavolo per una nuova selezione, oppure rivedi ora le stesse posizioni senza cambiare il riepilogo.",
              "Today's session is saved. Return to the Table tomorrow for a new selection, or review the same positions now without changing today's summary.",
            )}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.75rem" }}>
            <button onClick={onClose} className="btn btn-primary btn-lg" style={{ minHeight: "44px" }}>
              {tr("Torna al Tavolo", "Back to the Table")}
            </button>
            <button onClick={onRepeat} className="btn btn-ghost btn-lg" style={{ minHeight: "44px" }}>
              {tr("Rivedi le posizioni", "Review the positions")}
            </button>
          </div>
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

function whyTodayText(why: WhyToday): string {
  const label = getLang() === "en"
    ? why.anchorKey.replace(/^(anchor|motif):/, "").replace(/_/g, " ")
    : why.anchorLabel;
  switch (why.code) {
    case "focus_override":
      return tr(
        `Partiamo da ${label}: e' la posizione che hai scelto dal Tavolo.`,
        `We start from ${label}: this is the position you chose from the Table.`,
      );
    case "review_due":
      return tr(
        `Oggi torniamo su ${label}: la revisione registrata era prevista.`,
        `Today we return to ${label}: its recorded review was due.`,
      );
    case "low_mastery":
      return tr(
        `Oggi lavoriamo su ${label}: negli esercizi registrati il segnale di padronanza e' ancora basso.`,
        `Today we work on ${label}: its recorded exercise mastery signal is still low.`,
      );
    case "recent_errors":
      return tr(
        `Oggi torniamo su ${label}: negli ultimi tentativi registrati ci sono ${why.observedWrongAttempts} esiti errati. Il conteggio decide il ripasso, non spiega la causa.`,
        `Today we return to ${label}: the recent recorded attempts include ${why.observedWrongAttempts} wrong outcomes. This count schedules review; it does not explain the cause.`,
      );
    case "hint_dependency":
      return tr(
        `Oggi torniamo su ${label}: nei tentativi registrati l'aiuto e' stato usato ${why.observedHintUses} volte. E' un conteggio di utilizzo, non una diagnosi.`,
        `Today we return to ${label}: help was used ${why.observedHintUses} times in the recorded attempts. This is a usage count, not a diagnosis.`,
      );
    case "priority_pattern":
      return tr(
        `Oggi lavoriamo su ${label}: ha una priorita' relativa alta fra gli errori osservati disponibili.`,
        `Today we work on ${label}: it has high relative priority among the observed errors available.`,
      );
    case "current_support":
      return tr(
        `Oggi lavoriamo su ${label}: nel gruppo c'e' supporto Maia al livello attuale per una scelta accettabile osservata.`,
        `Today we work on ${label}: the group has current-level Maia support for an observed acceptable choice.`,
      );
    case "target_relevance":
      return tr(
        `Oggi lavoriamo su ${label}: il confronto Maia la rende rilevante nel percorso verso il target.`,
        `Today we work on ${label}: the Maia comparison makes it relevant on the path to your target.`,
      );
    default:
      return tr(
        `Oggi lavoriamo su ${label}: e' il gruppo selezionato fra le posizioni disponibili.`,
        `Today we work on ${label}: it is the selected group among the available positions.`,
      );
  }
}

function WhyTodayPanel({ selection }: { selection: AdaptiveSessionSelection<PositionExample> }) {
  const phaseNames = {
    review: tr("Guardo", "I look"),
    guided: tr("Aiuto", "With help"),
    solo: tr("Da solo", "On my own"),
  } as const;
  const supplementalByAnchor = (["review", "guided", "solo"] as const)
    .filter((key) => selection.phaseAnchors[key].anchorKey !== selection.anchorKey)
    .reduce<Array<{ anchorKey: string; anchorLabel: string; phases: string[] }>>((groups, key) => {
      const anchor = selection.phaseAnchors[key];
      const existing = groups.find((group) => group.anchorKey === anchor.anchorKey);
      if (existing) existing.phases.push(phaseNames[key]);
      else groups.push({ ...anchor, phases: [phaseNames[key]] });
      return groups;
    }, []);
  const reusedPhases = (["review", "guided", "solo"] as const)
    .filter((key) => selection.phaseNovelty[key] === "reused_in_session")
    .map((key) => phaseNames[key]);
  const supplementalDetail = supplementalByAnchor
    .map((anchor) => `${anchor.anchorLabel} (${anchor.phases.join(", ")})`)
    .join("; ");
  const supplementalText = selection.corpusFallback?.code === "secondary_anchor" && supplementalByAnchor.length > 0
    ? supplementalByAnchor.length === 1
      ? tr(
          `Per il tema principale, ${selection.anchorLabel}, ho ${selection.corpusFallback.primaryPositionsAvailable} posizioni disponibili. Aggiungo un richiamo distinto: ${supplementalDetail}.`,
          `For the main theme, ${selection.anchorLabel}, I have ${selection.corpusFallback.primaryPositionsAvailable} positions available. I add one distinct recall: ${supplementalDetail}.`,
        )
      : tr(
          `Per il tema principale, ${selection.anchorLabel}, ho ${selection.corpusFallback.primaryPositionsAvailable} posizioni disponibili. Le fasi indicate usano richiami aggiuntivi distinti: ${supplementalDetail}.`,
          `For the main theme, ${selection.anchorLabel}, I have ${selection.corpusFallback.primaryPositionsAvailable} positions available. The listed phases use distinct additional recalls: ${supplementalDetail}.`,
        )
    : null;
  const reuseText = selection.corpusFallback?.code === "position_reuse" || reusedPhases.length > 0
    ? tr(
        `In ${reusedPhases.join(", ") || tr("questa sessione", "this session")} una posizione ritorna: e' una ripetizione dichiarata, non una posizione nuova.`,
        `In ${reusedPhases.join(", ") || tr("questa sessione", "this session")} one position returns: it is an explicit repeat, not a new position.`,
      )
    : null;
  const supportingSignals = [
    selection.whyToday.currentSupport && selection.whyToday.code !== "current_support"
      ? tr(
          "Il gruppo include una scelta accettabile osservata con supporto Maia al livello attuale.",
          "The group includes an observed acceptable choice with current-level Maia support.",
        )
      : null,
    selection.whyToday.targetRelevant && selection.whyToday.code !== "target_relevance"
      ? tr(
          "Il confronto relativo Maia segnala anche rilevanza verso il target.",
          "The relative Maia comparison also signals relevance toward the target.",
        )
      : null,
  ].filter((line): line is string => line != null);

  return (
    <div
      className="sess-nonno"
      style={{ marginBottom: "1.5rem" }}
      aria-label={tr("Perche' oggi", "Why today")}
    >
      <span className="who">{tr("Perche' oggi", "Why today")}</span>
      <p>{whyTodayText(selection.whyToday)}</p>
      {supportingSignals.map((line) => <p key={line}>{line}</p>)}
      {supplementalText && <p style={{ color: "var(--color-text-soft)" }}>{supplementalText}</p>}
      {reuseText && <p style={{ color: "var(--color-text-soft)" }}>{reuseText}</p>}
    </div>
  );
}

function PhaseTheme({
  selection,
  phase,
}: {
  selection: AdaptiveSessionSelection<PositionExample>;
  phase: "guided" | "solo";
}) {
  const anchor = selection.phaseAnchors[phase];
  const secondary = anchor.anchorKey !== selection.anchorKey;
  const reused = selection.phaseNovelty[phase] === "reused_in_session";
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <div className="tt-eyebrow" style={{ color: secondary ? "var(--color-text-soft)" : "var(--color-brand-soft)" }}>
        {secondary ? tr("Richiamo aggiuntivo", "Additional recall") : tr("Tema principale", "Main theme")} · {anchor.anchorLabel}
      </div>
      {reused && (
        <p
          className="m-0 mt-1.5 text-xs leading-relaxed text-[color:var(--color-text-soft)]"
          role="status"
        >
          {tr(
            "Questa posizione ritorna: è un ripasso dichiarato, non un esercizio nuovo.",
            "This position returns: it is an explicit review, not a new exercise.",
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NonnoSession — orchestratore principale
// ---------------------------------------------------------------------------

export function NonnoSession({
  selection,
  targetRating,
  timeClass,
  onClose,
  sessionIdentity,
  initialPhase = "guardo",
  onPhaseChange,
  onCompleted,
  viaMorph = false,
}: Props) {
  // Reset the once-per-session board rise so the sit-down ritual plays once on
  // entry, then never again until the next session. Done during render (before
  // any child BoardScene mounts, so the first board reads a fresh flag) and
  // guarded to run a single time per session mount.
  const ritualResetRef = useRef(false);
  if (!ritualResetRef.current) {
    ritualResetRef.current = true;
    resetBoardSceneRitual();
  }

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [dominantMotif, setDominantMotif] = useState<string | null>(
    selection?.anchorLabel ?? null,
  );
  const startedTrackedRef = useRef(false);
  const completedTrackedRef = useRef(false);
  const attemptRecorderRef = useRef<ReturnType<typeof createEvaluatedAttemptRecorder> | null>(null);
  const passiveReviewRecorderRef = useRef<ReturnType<typeof createPassiveReviewRecorder> | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  if (!attemptRecorderRef.current) {
    attemptRecorderRef.current = createEvaluatedAttemptRecorder({
      recordLocal: recordVerdict,
      recordCloud: recordTrainingAttempt,
      reportCloudError: (cause) => {
        void reportClientError(cause, {
          component: "NonnoSession.trainingAttempt",
          context: { operation: "record_training_attempt" },
        });
      },
    });
  }
  if (!passiveReviewRecorderRef.current) {
    passiveReviewRecorderRef.current = createPassiveReviewRecorder({
      recordCloud: recordTrainingAttempt,
      reportCloudError: (cause) => {
        void reportClientError(cause, {
          component: "NonnoSession.passiveReview",
          context: { operation: "record_passive_review" },
        });
      },
    });
  }

  useEffect(() => {
    if (!selection || startedTrackedRef.current) return;
    startedTrackedRef.current = true;
    trackEvent("session_started", {
      event_version: 1,
      anchor_key: selection.anchorKey,
      reason_code: selection.whyToday.code,
      review_positions: selection.distinctPositions,
      has_secondary_anchor: selection.secondaryAnchor != null,
      corpus_fallback: selection.corpusFallback?.code ?? null,
      has_target: targetRating > 0,
    });
  }, [selection, targetRating]);

  useEffect(() => {
    if (!selection || phase !== "guardo" || !sessionIdentity) return;
    passiveReviewRecorderRef.current?.({
      sessionIdentity,
      anchorKey: selection.phaseAnchors.review.anchorKey,
      primaryAnchorKey: selection.anchorKey,
      sourceGameId: selection.review.source_game_id ?? null,
      positionId: stablePositionId(selection.review),
      fenBefore: selection.review.fen_before,
      reasonCode: selection.whyToday.code,
      corpusFallbackCode: selection.corpusFallback?.code ?? null,
      phaseNovelty: selection.phaseNovelty.review,
    });
  }, [phase, selection, sessionIdentity]);

  // Modal keyboard contract: focus the session, keep Tab inside it, route
  // Escape through the same close path, then restore the prior trigger.
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.focus({ preventScroll: true });
    }, 0);

    function handleKey(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (
        active === first
        || active === dialog
        || !(active instanceof Node && dialog.contains(active))
      )) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (
        active === last
        || !(active instanceof Node && dialog.contains(active))
      )) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKey, true);
      window.setTimeout(() => {
        const priorStillAvailable = previousFocus
          && previousFocus !== document.body
          && previousFocus.isConnected;
        const target = priorStillAvailable
          ? previousFocus
          : document.querySelector<HTMLElement>('[data-session-trigger="true"]');
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);

  if (!selection) {
    return <EmptyState onClose={onClose} dialogRef={dialogRef} />;
  }
  const selected = selection;

  const review = toPositionRow(selected.review, 0);
  const guided = toPositionRow(selected.guided, 1);
  const drill = toPositionRow(selected.solo, 2);
  const playFen = review.fen_before;
  const playColor: "white" | "black" = review.my_color;
  const patternLabel = selected.phaseAnchors.guided.anchorLabel;
  const drillPatternLabel = selected.phaseAnchors.solo.anchorLabel;

  function advance() {
    const idx = PHASE_ORDER.indexOf(phase);
    const next = idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : phase;
    navigateWithTransition(() => {
      setPhase(next);
    });
    if (next !== phase) onPhaseChange?.(next);
  }

  function handlePuzzleVerdict(
    mode: "guided" | "drill",
    phaseKey: "guided" | "solo",
    position: PositionRow,
    verdict: "perfect" | "ok" | "wrong",
    context: PositionPuzzleVerdictContext,
  ): void {
    attemptRecorderRef.current?.({
      anchorKey: selected.phaseAnchors[phaseKey].anchorKey,
      sourceGameId: position.source_game_id ?? null,
      positionId: position.position_id ?? stablePositionId(position),
      fenBefore: position.fen_before,
      mode,
      verdict,
      attempts: context.attempts,
      playedUci: context.playedUci,
      usedHint: context.usedHint,
      responseMs: context.responseMs,
      maiaCurrentAcceptableObservedPolicy:
        position.maia_mine_acceptable_observed_policy ?? null,
      maiaTargetAcceptableObservedPolicy:
        position.maia_target_acceptable_observed_policy ?? null,
      reasonCode: selected.whyToday.code,
      primaryAnchorKey: selected.anchorKey,
      corpusFallbackCode: selected.corpusFallback?.code ?? null,
      phaseNovelty: selected.phaseNovelty[phaseKey],
    });
  }

  function handlePlayDone(result: PlayResult) {
    if (!completedTrackedRef.current) {
      completedTrackedRef.current = true;
      trackEvent("session_completed", {
        event_version: 1,
        anchor_key: selected.anchorKey,
        reason_code: selected.whyToday.code,
        review_positions: selected.distinctPositions,
        has_secondary_anchor: selected.secondaryAnchor != null,
        corpus_fallback: selected.corpusFallback?.code ?? null,
        reached_practice_game: true,
      });
    }
    const motif = selected.anchorLabel;
    setDominantMotif(motif);
    onCompleted?.(result);

    // Write journal entry only once, only on full completion (not on early exit).
    if (!hasEntryToday("session_done")) {
      const body = `Ci siamo seduti su "${motif}". Hai rivisto i momenti, poi hai giocato.`;

      writeEntry({
        kind: "session_done",
        body,
        meta: {
          positions: selected.distinctPositions,
          dominant_motif: motif,
          anchor_key: selected.anchorKey,
          selection_reason: selected.whyToday.code,
        },
      });
    }
    navigateWithTransition(() => setPhase("saluto"));
  }

  function repeatReview(): void {
    navigateWithTransition(() => setPhase("guardo"));
    onPhaseChange?.("guardo");
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 overflow-auto"
      style={{ background: "var(--color-bg)" }}
      role="dialog"
      aria-modal="true"
      aria-label={tr("Sessione di revisione", "Review session")}
    >
      <SessionHeader phase={phase} onExit={onClose} />

      <div className="max-w-[1100px] mx-auto px-5 lg:px-10 py-8">
        {/* Fase 1 — GUARDO */}
        {phase === "guardo" && (
          <div key="phase-guardo" className="settle-in">
            <WhyTodayPanel selection={selected} />
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
              <span className="sess-phase-title">
                {tr("Nonno mi aiuta", "Nonno helps me")}
              </span>
            </div>
            <PhaseTheme selection={selected} phase="guided" />
            {/* Short bridge only: the data-rich line lives inside the puzzle voice */}
            <PhaseIntro
              text={tr(
                "Visto? Adesso proviamo insieme.",
                "Good. Now let's try together.",
              )}
            />
            <PositionPuzzle
              key={`aiuto-${guided.game_id}-${guided.ply}`}
              position={guided}
              patternLabel={patternLabel}
              withHint={true}
              introLines={buildAiutoIntroLines(guided)}
              onVerdict={(verdict, context) => {
                handlePuzzleVerdict("guided", "guided", guided, verdict, context);
              }}
              onNext={advance}
            />
          </div>
        )}

        {/* Fase 3 — DA SOLO */}
        {phase === "da-solo" && (
          <div key="phase-da-solo" className="settle-in">
            <div className="sess-phase-header">
              <div className="sess-phase-dot">3</div>
              <span className="sess-phase-title">
                {tr("Gioco da solo", "On my own")}
              </span>
            </div>
            <PhaseTheme selection={selected} phase="solo" />
            <PhaseIntro
              text={tr("Bene. Adesso da solo.", "Good. On your own now.")}
            />
            <PositionPuzzle
              key={`da-solo-${drill.game_id}-${drill.ply}`}
              position={drill}
              patternLabel={drillPatternLabel}
              withHint={false}
              introLines={buildDaSoloIntroLines(drill)}
              onVerdict={(verdict, context) => {
                handlePuzzleVerdict("drill", "solo", drill, verdict, context);
              }}
              onNext={advance}
            />
          </div>
        )}

        {/* Fase 4 — PARTITA vs avversario@target */}
        {phase === "partita" && (
          <div key="phase-partita" className="settle-in">
            <div className="sess-phase-header">
              <div className="sess-phase-dot honey">4</div>
              <span
                className="sess-phase-title"
                style={{ color: "var(--color-gold-soft)" }}
              >
                {tr(
                  selected.secondaryAnchor
                    ? selected.supplementalAnchors.length > 1
                      ? "Hai lavorato sul tema principale e su richiami aggiuntivi distinti. Ora gioca dalla posizione iniziale della sessione."
                      : "Hai lavorato sul tema principale e su un richiamo aggiuntivo. Ora gioca dalla posizione iniziale della sessione."
                    : "Hai lavorato sul tema principale. Ora gioca dalla posizione iniziale della sessione.",
                  selected.secondaryAnchor
                    ? selected.supplementalAnchors.length > 1
                      ? "You worked on the main theme and distinct additional recalls. Now play from the session's opening position."
                      : "You worked on the main theme and an additional recall. Now play from the session's opening position."
                    : "You worked on the main theme. Now play from the session's opening position.",
                )}
              </span>
            </div>
            <PlayStep
              startFen={playFen}
              myColor={playColor}
              maiaLevel={targetRating}
              timeClass={timeClass}
              onDone={handlePlayDone}
            />
          </div>
        )}

        {/* SALUTO */}
        {phase === "saluto" && (
          <div
            key="phase-saluto"
            className="settle-in"
            style={{ position: "relative" }}
          >
            <Saluto
              totalPositions={selected.distinctPositions}
              dominantMotif={dominantMotif}
              onClose={onClose}
              onRepeat={repeatReview}
            />
          </div>
        )}
      </div>
    </div>
  );
}
