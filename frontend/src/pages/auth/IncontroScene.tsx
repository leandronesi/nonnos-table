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
  analyzing: "Le sto guardando una per una. Quelle dove il tempo ti ha tradito le segno.",
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

const TEACH_SLIDES: TeachSlide[] = [
  {
    id: "time",
    voice: "C'e' chi le partite vinte non le perde sulla scacchiera. Le perde sull'orologio. E' la prima cosa che vado a cercare.",
    component: <TeachTime />,
  },
  {
    id: "maia",
    voice: "Non ti peso contro il computer perfetto. Ti peso contro chi vuoi diventare.",
    component: <TeachMaia />,
  },
  {
    id: "ancora",
    voice: "Non ti do una lista di errori. Ti do la cosa che ti tiene fermo. Una.",
    component: <TeachAncora />,
  },
];

const SLIDE_DURATION = 8000; // ms per ogni slide (calmo, tempo di leggere + guardare)

// ── Componente frase di Nonno con fade ───────────────────────────────────────

function NonnoVoice({ text, key: _key }: { text: string; key: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

  return (
    <p
      style={{
        fontFamily: "var(--font-body, Inter, system-ui, sans-serif)",
        fontSize: "1rem",
        fontWeight: 400,
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
      {/* Alone */}
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
  const width = isCoaching ? 100 : pct;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        opacity: 0.45,
      }}
    >
      <div
        style={{
          height: "2px",
          borderRadius: "999px",
          background: "var(--color-surface-3, #1c2138)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: "999px",
            background: "var(--color-brand, #7c5cff)",
            width: `${width}%`,
            transition: "width 600ms cubic-bezier(0.23,1,0.32,1)",
            animation: isCoaching ? "pulseGlow 2.4s ease-in-out infinite" : "none",
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
}: {
  brief: CoachLlmBrief | null;
  onEnter: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(t);
  }, []);

  const voiceText =
    brief?.voice_message ??
    brief?.one_line_diagnosis ??
    "Ho visto abbastanza. Vieni, siediti. C'e' una cosa sola che voglio dirti.";

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
      {/* La frase */}
      <p
        style={{
          fontFamily: "var(--font-display, Inter Tight, Inter, system-ui, sans-serif)",
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
}

// ── Componente scena (pura presentazione) ─────────────────────────────────────

export function IncontroScene({ progress, readyBrief, error, onEnter, onExit }: IncontroSceneProps) {
  // Stato del ciclo slide
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideVisible, setSlideVisible] = useState(true);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phase = progress?.phase ?? "pending";
  const voiceKey = `${phase}-${slideIndex}`;

  // Testo voce: durante analyzing/coaching usa la slide, altrimenti la fase
  const showSlides =
    (phase === "analyzing" || phase === "coaching") && readyBrief === undefined;
  const currentVoice = showSlides
    ? TEACH_SLIDES[slideIndex]?.voice
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
        setSlideIndex((i) => (i + 1) % TEACH_SLIDES.length);
        setSlideVisible(true);
      }, 500);
    }, SLIDE_DURATION);
    return () => {
      if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
    };
  }, [showSlides, slideIndex, slideVisible]);

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
                {/* Testo voce */}
                <NonnoVoice text={currentVoice} key={voiceKey} />

                {/* Animazione didattica (solo analyzing/coaching) */}
                {showSlides && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      opacity: slideVisible ? 1 : 0,
                      transform: slideVisible ? "scale(1)" : "scale(0.96)",
                      transition:
                        "opacity 500ms cubic-bezier(0.23,1,0.32,1), transform 500ms cubic-bezier(0.23,1,0.32,1)",
                    }}
                  >
                    {TEACH_SLIDES[slideIndex]?.component}
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
                    ? "Stockfish gira nel tuo browser. Non chiudere la pagina: ci vuole qualche minuto."
                    : "Il primo giro scarica circa 44 MB del modello. Poi resta in cache."}
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
