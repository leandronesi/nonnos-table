/**
 * IncontroScene — pura presentazione de "Il Primo Incontro".
 *
 * Nessuna logica di orchestrazione, navigazione o auth.
 * Riceve tutto via props e delega le CTA ai callback onEnter/onExit.
 */

import { useEffect, useRef, useState } from "react";
import type { OrchestratorProgress } from "../../pipeline/orchestrator";
import { TeachTime } from "../../components/onboarding/TeachTime";
import { TeachMaia } from "../../components/onboarding/TeachMaia";
import { TeachAncora } from "../../components/onboarding/TeachAncora";
import { prefersReducedMotion } from "../../lib/motion";
import { tr } from "../../i18n/lang";

// Shape del coach_brief.json scritto dalla Edge Function coach-llm.
export interface CoachLlmBrief {
  one_line_diagnosis?: string;
  voice_message?: string;
  weekly_focus?: string;
  top_3_freni?: Array<{ title: string; evidence: string; next_step: string }>;
}

// ── Frasi di Nonno per fase ───────────────────────────────────────────────────

function getPhaseVoice(): Record<OrchestratorProgress["phase"], string> {
  return {
    pending:   tr("Dammi un attimo. Mi metto a posto.", "One moment. Getting ready."),
    ingesting: tr("Dammi un minuto. Sto scaricando le tue ultime partite.", "One moment. Downloading your recent games."),
    analyzing: tr(
      "Comincio dalle tue ultime partite e vado indietro, una per una. Quelle dove il tempo ti ha tradito le segno.",
      "Starting from your most recent games and working back. I mark the ones where the clock caught you.",
    ),
    coaching:  tr("Ci sono quasi. Sto mettendo insieme la prima cosa da dirti.", "Almost there. Putting together the first thing to show you."),
    ready:     tr("Fatto. Vieni, siediti.", "Done. Come, sit down."),
    error:     tr("Mi sono inceppato su qualcosa. Riprova, per favore.", "Something went wrong on my end. Please try again."),
  };
}

// ── Mini-animazioni didattiche (fase analyzing/coaching) ─────────────────────

interface TeachSlide {
  id: string;
  voice: string;
  component: React.ReactNode;
}

function buildTeachSlides(targetRating?: number): TeachSlide[] {
  return [
    {
      id: "time",
      voice: tr(
        "C'e' chi le partite vinte non le perde sulla scacchiera. Le perde sull'orologio. E' la prima cosa che vado a cercare.",
        "Some players do not lose won games on the board. They lose them on the clock. That is the first thing I look for.",
      ),
      component: <TeachTime />,
    },
    {
      id: "maia",
      voice: tr(
        "Non ti peso contro il computer perfetto. Ti peso contro chi vuoi diventare.",
        "I do not measure you against the perfect computer. I measure you against the player you are becoming.",
      ),
      component: <TeachMaia targetRating={targetRating} />,
    },
    {
      id: "ancora",
      voice: tr(
        "Non ti do una lista di errori. Ti do la cosa che ti tiene fermo. Una.",
        "I do not give you a list of mistakes. I give you the one thing that is keeping you here.",
      ),
      component: <TeachAncora />,
    },
  ];
}

const SLIDE_DURATION = 8000; // ms per ogni slide (calmo, tempo di leggere + guardare)

// ── Componente frase di Nonno con fade ───────────────────────────────────────

function NonnoVoice({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

  return (
    <p
      style={{
        fontFamily: "var(--font-voice)",
        fontSize: "1rem",
        fontWeight: 500,
        lineHeight: 1.65,
        color: "var(--color-text-soft, #b6bcd6)",
        margin: 0,
        maxWidth: "36ch",
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(6px)",
        transition: "opacity 700ms cubic-bezier(0.23,1,0.32,1), transform 700ms cubic-bezier(0.23,1,0.32,1)",
      }}
    >
      {text}
    </p>
  );
}

// ── Lampada decorativa ────────────────────────────────────────────────────────

function RoomLamp() {
  // One-shot light-on: the glow fades in from opacity 0 at mount.
  // Structural elements (shade, stem, base) are always visible; only the
  // radial glow animates so the lamp "switches on" rather than popping.
  const [lit, setLit] = useState(prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) return;
    // Start invisible, then trigger on the next frame so the transition fires.
    const t = requestAnimationFrame(() => setLit(true));
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width: "4.5rem",
        height: "6rem",
        margin: "0 auto 2rem",
        flexShrink: 0,
      }}
    >
      {/* Alone — animates opacity 0→1 on mount (lamp-on effect) */}
      <div
        style={{
          position: "absolute",
          left: "-3.5rem",
          top: "-2rem",
          width: "11rem",
          height: "11rem",
          borderRadius: "999px",
          background: "radial-gradient(circle, color-mix(in srgb, #f6c64a 16%, transparent), color-mix(in srgb, #f6c64a 5%, transparent) 42%, transparent 68%)",
          pointerEvents: "none",
          opacity: lit ? 1 : 0,
          transition: prefersReducedMotion()
            ? "none"
            : "opacity 900ms ease-out",
        }}
      />
      {/* Paralume */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "0.7rem",
          width: "3.1rem",
          height: "1.9rem",
          clipPath: "polygon(20% 0, 80% 0, 100% 100%, 0 100%)",
          border: "1px solid color-mix(in srgb, #f6c64a 40%, transparent)",
          background: "linear-gradient(180deg, #f6c64a, #8d642f)",
        }}
      />
      {/* Stelo */}
      <div
        style={{
          position: "absolute",
          left: "2.15rem",
          top: "1.85rem",
          width: "2px",
          height: "3.5rem",
          background: "color-mix(in srgb, #f6c64a 38%, #1e2440)",
        }}
      />
      {/* Base */}
      <div
        style={{
          position: "absolute",
          left: "1.3rem",
          bottom: 0,
          width: "1.9rem",
          height: "0.4rem",
          borderRadius: "999px",
          background: "color-mix(in srgb, #f6c64a 36%, #2a3158)",
        }}
      />
    </div>
  );
}

// ── Pendolo di progresso (discreto, in fondo) ────────────────────────────────

function ProgressThread({
  phase,
  pct,
}: {
  phase: OrchestratorProgress["phase"];
  pct: number;
}) {
  const isCoaching = phase === "coaching";
  // During coaching the filled portion covers 100% and pulses.
  const filledPct = isCoaching ? 100 : pct;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        opacity: 0.55,
      }}
    >
      {/* Track: dashed background (the "future" part) */}
      <div
        style={{
          position: "relative",
          height: "2px",
          // Dashed track for the full width — represents what's ahead.
          backgroundImage:
            "repeating-linear-gradient(90deg, var(--color-line-strong) 0 4px, transparent 4px 10px)",
        }}
      >
        {/* Filled overlay (inchiostro pieno) — what's been covered */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${filledPct}%`,
            background: "var(--color-brand-soft)",
            transition: prefersReducedMotion()
              ? "none"
              : "width 600ms cubic-bezier(0.23,1,0.32,1)",
            // Pulse only on the filled portion during coaching phase.
            animation: isCoaching
              ? "pulseGlow 2.4s ease-in-out infinite"
              : "none",
          }}
        />
      </div>
      {pct > 0 && !isCoaching && (
        <span
          style={{
            fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
            fontSize: "0.625rem",
            color: "var(--color-faint, #4a5070)",
            textAlign: "right",
          }}
        >
          {pct}%
        </span>
      )}
    </div>
  );
}

// ── Schermata "primo colpo" (al ready) ───────────────────────────────────────

function PrimoColpo({
  brief,
  onEnter,
  username,
  currentRating,
  tcLabel,
}: {
  brief: CoachLlmBrief | null;
  onEnter: () => void;
  username?: string;
  currentRating?: number;
  tcLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(t);
  }, []);

  // Fallback phrase: use data-rich version if username+rating+tc are available.
  const fallback =
    username && currentRating && tcLabel
      ? tr(
          `Ho guardato le tue ${tcLabel}, ${username}. Sei a ${currentRating} e c'e' qualcosa che si ripete. Una cosa sola: te la mostro, poi giochiamo. Siediti. Domani ne apriamo un'altra.`,
          `I looked at your ${tcLabel} games, ${username}. You are at ${currentRating} and there is something that keeps coming up. One thing. I will show you, then we play. Sit down. Tomorrow we open another one.`,
        )
      : tr(
          "Ho guardato. C'e' una cosa che torna, partita dopo partita. Non e' la mossa: e' il momento in cui la cerchi. Siediti, te la mostro. Domani ripartiamo da li'.",
          "I looked. There is something that comes back, game after game. It is not the move: it is the moment you go looking for it. Sit down, I will show you. Tomorrow we pick it up from there.",
        );

  const voiceText =
    brief?.voice_message ??
    brief?.one_line_diagnosis ??
    fallback;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1.75rem",
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(10px)",
        transition: "opacity 800ms cubic-bezier(0.23,1,0.32,1), transform 800ms cubic-bezier(0.23,1,0.32,1)",
      }}
    >
      {/* La frase — voce serif, peso 600 come da spec Onda D */}
      <p
        style={{
          fontFamily: "var(--font-voice)",
          fontWeight: 600,
          fontSize: "clamp(1.05rem, 3.5vw, 1.25rem)",
          lineHeight: 1.55,
          color: "var(--color-text, #eef0fa)",
          margin: 0,
          maxWidth: "34ch",
        }}
      >
        {voiceText}
      </p>

      {/* CTA unica */}
      <button
        onClick={onEnter}
        className="btn btn-primary"
        style={{
          alignSelf: "flex-start",
          fontWeight: 700,
          padding: "12px 28px",
          fontSize: "0.95rem",
          letterSpacing: "0.01em",
        }}
      >
        {tr("Sediamoci", "Let's sit down.")}
      </button>
    </div>
  );
}

// ── Props del componente scena ────────────────────────────────────────────────

export interface IncontroSceneProps {
  progress: OrchestratorProgress | null;
  readyBrief: CoachLlmBrief | null | undefined;
  error: string | null;
  onEnter: () => void;
  onExit: () => void;
  targetRating?: number;
  /** Chess.com username for the fallback primo-colpo phrase. */
  username?: string;
  /** Player's current rating for the fallback primo-colpo phrase. Not stored in profiles: pass only when available from Chess.com API. */
  currentRating?: number;
  /** Time class label (rapid/blitz/bullet) for the fallback primo-colpo phrase. */
  tcLabel?: string;
}

// ── Il Patto (one-shot, prima delle slide didattiche) ───────────────────────

// The five lines of "il Patto" — shown once at the very start of the wait,
// before the TEACH_SLIDES cycle begins. Each line is a short breath.
// Must be a function so tr() is evaluated at render-time (not frozen at module load).
function getPattoLines(): string[] {
  return [
    tr(
      "Ogni mattina prendo una tua partita vera e la guardo bene.",
      "Every morning I take one of your real games and look at it carefully.",
    ),
    tr(
      "Non tutta: trovo il momento che conta davvero, e te lo mostro.",
      "Not the whole thing. I find the moment that matters, and I show you.",
    ),
    tr(
      "Poi giochiamo insieme, contro uno del tuo livello.",
      "Then we play together, against someone at your level.",
    ),
    tr("Un quarto d'ora. Poi vai.", "Fifteen minutes. Then you go."),
    tr("Torna domani, e ricominciamo.", "Come back tomorrow, and we start again."),
  ];
}

// Duration the Patto is shown before yielding to TEACH_SLIDES (ms).
// ~9-10 s covers ingesting and the early analyzing phase.
const PATTO_DURATION = 9500;

// Renders the Patto text: five lines separated by small gaps, in Nonno's voice.
function PattoCard({ visible }: { visible: boolean }) {
  const reduced = prefersReducedMotion();
  const lines = getPattoLines();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        opacity: visible ? 1 : 0,
        transform: !reduced && !visible ? "translateY(6px)" : "none",
        transition: reduced
          ? "none"
          : "opacity 700ms cubic-bezier(0.23,1,0.32,1), transform 700ms cubic-bezier(0.23,1,0.32,1)",
      }}
    >
      {lines.map((line, i) => (
        <p
          key={i}
          style={{
            fontFamily: "var(--font-voice)",
            fontSize: "1rem",
            fontWeight: i === lines.length - 1 ? 600 : 500,
            lineHeight: 1.65,
            color:
              i === lines.length - 1
                ? "var(--color-text, #eef0fa)"
                : "var(--color-text-soft, #b6bcd6)",
            margin: 0,
            maxWidth: "36ch",
          }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

// ── Componente scena (pura presentazione) ─────────────────────────────────────

export function IncontroScene({ progress, readyBrief, error, onEnter, onExit, targetRating, username, currentRating, tcLabel }: IncontroSceneProps) {
  // Patto: shown once at the very start; never re-enters the slide cycle.
  const [pattoShown, setPattoShown] = useState(false);
  const [pattoVisible, setPattoVisible] = useState(false);
  const pattoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stato del ciclo slide
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideVisible, setSlideVisible] = useState(true);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teachSlides = buildTeachSlides(targetRating);

  const phase = progress?.phase ?? "pending";
  const voiceKey = pattoShown ? `${phase}-${slideIndex}` : "patto";

  // Trigger Patto on first render (one-shot): fade in immediately, then after
  // PATTO_DURATION mark it done so TEACH_SLIDES can start. If readyBrief
  // arrives before the timer fires, the Patto is simply replaced by PrimoColpo
  // (the `isReady` branch hides the whole in-progress block).
  useEffect(() => {
    if (pattoShown) return;
    // Fade in on next frame so CSS transition fires.
    const rafId = requestAnimationFrame(() => setPattoVisible(true));
    pattoTimerRef.current = setTimeout(() => {
      setPattoShown(true);
    }, PATTO_DURATION);
    return () => {
      cancelAnimationFrame(rafId);
      if (pattoTimerRef.current) clearTimeout(pattoTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty: runs once at mount

  // Testo voce: durante analyzing/coaching usa la slide, altrimenti la fase.
  // While Patto is showing, we suppress the phase voice (Patto owns the slot).
  const showSlides =
    pattoShown &&
    (phase === "analyzing" || phase === "coaching") &&
    readyBrief === undefined;
  const currentVoice = showSlides
    ? teachSlides[slideIndex]?.voice
    : getPhaseVoice()[phase];

  // Ciclo slide durante analyzing/coaching
  useEffect(() => {
    if (!showSlides) {
      if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
      return;
    }
    slideTimerRef.current = setTimeout(() => {
      setSlideVisible(false);
      setTimeout(() => {
        setSlideIndex((i) => (i + 1) % teachSlides.length);
        setSlideVisible(true);
      }, 500);
    }, SLIDE_DURATION);
    return () => {
      if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
    };
  }, [showSlides, slideIndex, slideVisible, teachSlides.length]);

  // Calcolo progresso per il pendolo
  const ratio =
    progress && progress.gamesTotal > 0
      ? Math.min(1, progress.gamesDone / Math.max(1, progress.gamesTotal))
      : phase === "ingesting" && progress && progress.monthsTotal > 0
      ? progress.monthsDone / progress.monthsTotal
      : 0;
  const pct = Math.round(ratio * 100);

  const isError = phase === "error";
  const isReady = readyBrief !== undefined;

  return (
    <div
      style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg, #060814)",
        padding: "clamp(1.5rem, 6vw, 3rem) 1.25rem",
        overflowX: "hidden",
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
          fontSize: "0.625rem",
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--color-brand-soft, #a18bff)",
          marginBottom: "2.5rem",
        }}
      >
        Nonno&apos;s Table
      </div>

      {/* Scena */}
      <div
        style={{
          width: "100%",
          maxWidth: "22rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0",
        }}
      >
        {/* Lampada */}
        <RoomLamp />

        {/* Card scena */}
        <div
          style={{
            width: "100%",
            background: "var(--color-surface, #0f1325)",
            border: "1px solid var(--color-line, #1e2440)",
            borderRadius: "14px",
            padding: "clamp(1.5rem, 6vw, 2rem)",
            display: "flex",
            flexDirection: "column",
            gap: "1.75rem",
          }}
        >
          {/* Stato: errore */}
          {isError && (
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
                  fontSize: "0.875rem",
                  color: "var(--color-danger, #f43f5e)",
                  margin: "0 0 0.75rem",
                  lineHeight: 1.55,
                }}
              >
                {error ?? getPhaseVoice().error}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="btn btn-ghost btn-sm"
              >
                {tr("Riprova", "Try again")}
              </button>
            </div>
          )}

          {/* Stato: ready — primo colpo */}
          {!isError && isReady && (
            <PrimoColpo
              brief={readyBrief}
              onEnter={onEnter}
              username={username}
              currentRating={currentRating}
              tcLabel={tcLabel}
            />
          )}

          {/* Stato: in corso */}
          {!isError && !isReady && (
            <>
              {/* Voce di Nonno + slide didattica */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.25rem",
                }}
              >
                {/* Il Patto (one-shot): shown before TEACH_SLIDES cycle starts */}
                {!pattoShown && (
                  <PattoCard visible={pattoVisible} />
                )}

                {/* Phase voice — only when Patto is done */}
                {pattoShown && (
                  <NonnoVoice text={currentVoice} key={voiceKey} />
                )}

                {/* Animazione didattica (solo analyzing/coaching) */}
                {showSlides && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      opacity: slideVisible ? 1 : 0,
                      transform: slideVisible
                        ? "translateY(0)"
                        : "translateY(6px)",
                      transition: prefersReducedMotion()
                        ? "none"
                        : "opacity 400ms var(--ease-settle), transform 400ms var(--ease-settle)",
                    }}
                  >
                    {teachSlides[slideIndex]?.component}
                  </div>
                )}
              </div>

              {/* Pendolo di progresso — secondario, in fondo */}
              <div style={{ marginTop: "0.25rem" }}>
                <ProgressThread phase={phase} pct={pct} />

                {/* Info tecnica minimal */}
                {phase === "ingesting" && progress && progress.monthsTotal > 0 && (
                  <p
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.75rem",
                      color: "var(--color-faint, #4a5070)",
                      fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
                    }}
                  >
                    {progress.monthsDone}/{progress.monthsTotal} {tr("mesi", "months")}
                  </p>
                )}
                {phase === "coaching" && progress?.message && (
                  <p
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.75rem",
                      color: "var(--color-faint, #4a5070)",
                      fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
                    }}
                  >
                    {progress.message}
                  </p>
                )}
              </div>

              {/* Nota per fasi lunghe */}
              {(phase === "analyzing" || phase === "coaching") && (
                <p
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--color-faint, #4a5070)",
                    lineHeight: 1.55,
                    margin: 0,
                  }}
                >
                  {phase === "analyzing"
                    ? tr(
                        "Comincio dalle tue ultime dieci partite e vado indietro nel tempo. Stockfish gira nel tuo browser: non chiudere la pagina, ci vuole qualche minuto.",
                        "Starting from your last ten games and going back in time. Stockfish runs in your browser: do not close the page, it takes a few minutes.",
                      )
                    : tr(
                        "La prima volta ci vuole un po' piu' di tempo. Dopo va piu' veloce.",
                        "The first time takes a little longer. After that it is faster.",
                      )}
                </p>
              )}
            </>
          )}

          {/* Errore separato (fuori dal box errore) */}
          {error && !isError && (
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
                  color: "var(--color-danger, #f43f5e)",
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
                {tr("Riprova", "Try again")}
              </button>
            </div>
          )}

          {/* Esci — sempre disponibile */}
          <div
            style={{
              paddingTop: "0.25rem",
              borderTop: "1px solid var(--color-line, #1e2440)",
            }}
          >
            <button
              onClick={onExit}
              className="btn btn-ghost btn-sm"
            >
              {tr("Esci dall'account", "Sign out")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
