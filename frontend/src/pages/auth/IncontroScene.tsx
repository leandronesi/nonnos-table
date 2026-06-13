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

// Shape del coach_brief.json scritto dalla Edge Function coach-llm.
export interface CoachLlmBrief {
  one_line_diagnosis?: string;
  voice_message?: string;
  weekly_focus?: string;
  top_3_freni?: Array<{ title: string; evidence: string; next_step: string }>;
}

// ── Frasi di Nonno per fase ───────────────────────────────────────────────────

const PHASE_VOICE: Record<OrchestratorProgress["phase"], string> = {
  pending:   "Dammi un attimo. Mi metto a posto.",
  ingesting: "Dammi un minuto. Sto scaricando le tue ultime partite.",
  analyzing: "Comincio dalle tue ultime partite e vado indietro, una per una. Quelle dove il tempo ti ha tradito le segno.",
  coaching:  "Ci sono quasi. Sto mettendo insieme la prima cosa da dirti.",
  ready:     "Fatto. Vieni, siediti.",
  error:     "Mi sono inceppato su qualcosa. Riprova, per favore.",
};

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
      voice: "C'e' chi le partite vinte non le perde sulla scacchiera. Le perde sull'orologio. E' la prima cosa che vado a cercare.",
      component: <TeachTime />,
    },
    {
      id: "maia",
      voice: "Non ti peso contro il computer perfetto. Ti peso contro chi vuoi diventare.",
      component: <TeachMaia targetRating={targetRating} />,
    },
    {
      id: "ancora",
      voice: "Non ti do una lista di errori. Ti do la cosa che ti tiene fermo. Una.",
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
      ? `Ho guardato le tue ${tcLabel}, ${username}. Sei a ${currentRating} e c'e' qualcosa che si ripete. Una cosa sola: te la mostro, poi giochiamo. Siediti. Domani ne apriamo un'altra.`
      : "Ho guardato. C'e' una cosa che torna, partita dopo partita. Non e' la mossa: e' il momento in cui la cerchi. Siediti, te la mostro. Domani ripartiamo da li'.";

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
        Sediamoci
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
const PATTO_LINES = [
  "Ogni mattina prendo una tua partita vera e la guardo bene.",
  "Non tutta: trovo il momento che conta davvero, e te lo mostro.",
  "Poi giochiamo insieme, contro uno del tuo livello.",
  "Un quarto d'ora. Poi vai.",
  "Torna domani, e ricominciamo.",
];

// Duration the Patto is shown before yielding to TEACH_SLIDES (ms).
// ~9-10 s covers ingesting and the early analyzing phase.
const PATTO_DURATION = 9500;

// Renders the Patto text: five lines separated by small gaps, in Nonno's voice.
function PattoCard({ visible }: { visible: boolean }) {
  const reduced = prefersReducedMotion();
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
      {PATTO_LINES.map((line, i) => (
        <p
          key={i}
          style={{
            fontFamily: "var(--font-voice)",
            fontSize: "1rem",
            fontWeight: i === PATTO_LINES.length - 1 ? 600 : 500,
            lineHeight: 1.65,
            color:
              i === PATTO_LINES.length - 1
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
    : PHASE_VOICE[phase];

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
        il Tavolo del Nonno
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
                {error ?? PHASE_VOICE.error}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="btn btn-ghost btn-sm"
              >
                Riprova
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
                    {progress.monthsDone}/{progress.monthsTotal} mesi
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
                    ? "Comincio dalle tue ultime dieci partite e vado indietro nel tempo. Stockfish gira nel tuo browser: non chiudere la pagina, ci vuole qualche minuto."
                    : "La prima volta ci vuole un po' piu' di tempo. Dopo va piu' veloce."}
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
                Riprova
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
              Esci dall&rsquo;account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
