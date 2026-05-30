/**
 * IncontroPreview — strumento dev per previsualizzare la scena "Il Primo Incontro".
 *
 * Guida un OrchestratorProgress FINTO attraverso le fasi con timer automatici.
 * Disponibile solo in sviluppo (la rotta e' registrata solo se import.meta.env.DEV).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { IncontroScene, type CoachLlmBrief } from "../auth/IncontroScene";
import type { OrchestratorProgress } from "../../pipeline/orchestrator";

type Phase = OrchestratorProgress["phase"];

const FAKE_BRIEF: CoachLlmBrief = {
  voice_message:
    "Una cosa l'ho gia' vista. Tre volte questo mese eri in vantaggio e l'hai buttata con l'orologio addosso. Martedi' sera eri a piu' tre.",
};

// Durata di ogni fase in ms (per la sequenza automatica)
const PHASE_DURATIONS: Record<Phase, number> = {
  pending:   1000,
  ingesting: 3000,
  analyzing: 8000,
  coaching:  4000,
  ready:     0,    // terminale
  error:     0,    // non usata nella sequenza automatica
};

const PHASE_SEQUENCE: Phase[] = ["pending", "ingesting", "analyzing", "coaching", "ready"];

function buildProgress(phase: Phase, tick: number): OrchestratorProgress {
  switch (phase) {
    case "ingesting":
      return {
        phase,
        monthsTotal: 18,
        monthsDone: Math.min(18, Math.round((tick / PHASE_DURATIONS.ingesting) * 18)),
        gamesTotal: 0,
        gamesDone: 0,
      };
    case "analyzing":
      return {
        phase,
        monthsTotal: 0,
        monthsDone: 0,
        gamesTotal: 20,
        gamesDone: Math.min(20, Math.round((tick / PHASE_DURATIONS.analyzing) * 20)),
      };
    case "coaching":
      return {
        phase,
        monthsTotal: 0,
        monthsDone: 0,
        gamesTotal: 0,
        gamesDone: 0,
        message: "Metto insieme la prima cosa",
      };
    default:
      return { phase, monthsTotal: 0, monthsDone: 0, gamesTotal: 0, gamesDone: 0 };
  }
}

export function IncontroPreview() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const [readyBrief, setReadyBrief] = useState<CoachLlmBrief | null | undefined>(undefined);

  const phaseStartRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);
  const phaseIndexRef = useRef(phaseIndex);
  phaseIndexRef.current = phaseIndex;

  const currentPhase = PHASE_SEQUENCE[phaseIndex] ?? "ready";

  const jumpToPhase = useCallback((idx: number) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    phaseStartRef.current = Date.now();
    setPhaseIndex(idx);
    setTick(0);
    setReadyBrief(idx >= PHASE_SEQUENCE.indexOf("ready") ? FAKE_BRIEF : undefined);
  }, []);

  const replay = useCallback(() => {
    jumpToPhase(0);
  }, [jumpToPhase]);

  // Sequenza automatica via rAF-based tick
  useEffect(() => {
    if (currentPhase === "ready" || currentPhase === "error") return;

    const duration = PHASE_DURATIONS[currentPhase];

    function frame() {
      const elapsed = Date.now() - phaseStartRef.current;
      setTick(elapsed);

      if (elapsed >= duration) {
        const nextIdx = phaseIndexRef.current + 1;
        if (nextIdx < PHASE_SEQUENCE.length) {
          phaseStartRef.current = Date.now();
          setPhaseIndex(nextIdx);
          setTick(0);
          if (PHASE_SEQUENCE[nextIdx] === "ready") {
            setReadyBrief(FAKE_BRIEF);
          }
        }
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [currentPhase]);

  const progress = currentPhase !== "ready" ? buildProgress(currentPhase, tick) : {
    phase: "ready" as Phase,
    monthsTotal: 0,
    monthsDone: 0,
    gamesTotal: 0,
    gamesDone: 0,
  };

  return (
    <div style={{ position: "relative" }}>
      {/* ── Barra controlli dev ── */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: "rgba(10,12,28,0.92)",
          borderBottom: "1px solid #2a3158",
          padding: "0.5rem 1rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          backdropFilter: "blur(8px)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "0.625rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#4a5070",
            marginRight: "0.25rem",
          }}
        >
          dev preview
        </span>

        {(["ingesting", "analyzing", "coaching", "ready"] as Phase[]).map((ph) => {
          const idx = PHASE_SEQUENCE.indexOf(ph);
          const active = currentPhase === ph;
          return (
            <button
              key={ph}
              onClick={() => jumpToPhase(idx)}
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "0.6875rem",
                padding: "3px 10px",
                borderRadius: "4px",
                border: active ? "1px solid #7c5cff" : "1px solid #2a3158",
                background: active ? "rgba(124,92,255,0.18)" : "transparent",
                color: active ? "#a18bff" : "#717892",
                cursor: "pointer",
                transition: "all 180ms",
              }}
            >
              {ph}
            </button>
          );
        })}

        <button
          onClick={replay}
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "0.6875rem",
            padding: "3px 10px",
            borderRadius: "4px",
            border: "1px solid #2a3158",
            background: "transparent",
            color: "#b6bcd6",
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          replay da capo
        </button>
      </div>

      {/* ── Scena (con offset per la barra) ── */}
      <div style={{ paddingTop: "2.5rem" }}>
        <IncontroScene
          progress={progress}
          readyBrief={readyBrief}
          error={null}
          onEnter={replay}
          onExit={() => alert("[dev] onExit: nessuna azione")}
        />
      </div>
    </div>
  );
}
