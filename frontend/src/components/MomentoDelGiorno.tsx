/**
 * MomentoDelGiorno — the "spine made position" block on TavoloHome.
 *
 * Selects the single best Momento from aggregates.cadute (or .examples)
 * and displays it with a mini board that plays the story of the error in a
 * calm loop (wave B cinema coreography).
 *
 * BOARD ANIMATION STATE MACHINE (useEffect + setTimeout, max 3 cycles):
 *   start  → 800ms  → played  (mossa giocata, freccia rossa)
 *          → 1600ms → back    (torna al before, nessuna freccia)
 *          → 500ms  → best    (mossa giusta, freccia verde)
 *          → 2000ms → start
 *   After 3 full cycles → rest (fen_before con ENTRAMBE le frecce, statico).
 *
 * Animation starts only when the card enters the viewport AND
 * !prefersReducedMotion() AND both FEN derivations succeed.
 * Otherwise falls back to the static view with both arrows (today's view).
 *
 * Selection logic:
 *   1. Among examples with priority_score === 3, pick max drill_value.
 *   2. Fallback: pick max cp_loss from all examples.
 *
 * Voice triplet:
 *   a) tempo: spent_seconds when not null.
 *   b) Avversario: p_target_plays_best_sf AND p_mine_plays_best_sf when both not null.
 *   c) best move: always shown when best_uci is present.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chess } from "chess.js";
import type { PositionExample } from "../pipeline/aggregate";
import { BoardView } from "./BoardView";
import { uciToArrow, uciToSan } from "../pages/quaderno/boardArrows";
import { prefersReducedMotion } from "../lib/motion";

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Picks the best Momento from a pool.
 * Returns null only if the pool is empty.
 */
export function selectMomento(pool: PositionExample[]): PositionExample | null {
  if (pool.length === 0) return null;

  // Path 1: Maia ran — priority_score === 3, max drill_value.
  const moneyPool = pool.filter(
    (p) => p.priority_score === 3 && p.drill_value != null,
  );
  if (moneyPool.length > 0) {
    return moneyPool.reduce((best, p) =>
      (p.drill_value ?? -Infinity) > (best.drill_value ?? -Infinity) ? p : best,
    );
  }

  // Path 2: Maia not available (or no priority_score === 3) — max cp_loss.
  return pool.reduce((best, p) => (p.cp_loss > best.cp_loss ? p : best));
}

// ── FEN derivation helpers ────────────────────────────────────────────────────

/**
 * Applies a UCI move to a FEN string and returns the resulting FEN.
 * Returns null if the move is illegal or the FEN is invalid.
 */
function fenAfterUci(fenBefore: string, uci: string): string | null {
  try {
    const chess = new Chess(fenBefore);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const result = chess.move({ from, to, promotion });
    if (!result) return null;
    return chess.fen();
  } catch {
    return null;
  }
}

// ── Voice lines (deterministic from data) ─────────────────────────────────────

function buildTempoLine(spent_seconds: number | null | undefined): string | null {
  if (spent_seconds == null) return null;
  return `In ${spent_seconds} secondi.`;
}

function buildAvversarioLine(
  p_target: number | null | undefined,
  p_mine: number | null | undefined,
  targetRating: number | null,
): string | null {
  if (p_target == null || p_mine == null) return null;
  const targetN = Math.round(p_target * 10);
  const mineN = Math.round(p_mine * 10);
  const opener =
    targetRating != null && targetRating > 0
      ? `Uno al tuo ${targetRating} la trova ${targetN} volte su 10.`
      : `Il giocatore che vuoi diventare la trova ${targetN} volte su 10.`;
  const mineClause =
    mineN === 0
      ? "Tu, oggi, nemmeno una."
      : mineN === 1
        ? "Tu, oggi, una."
        : `Tu, oggi, ${mineN}.`;
  return `${opener} ${mineClause}`;
}

function buildBestMoveLine(
  fenBefore: string,
  best_uci: string | null | undefined,
): string | null {
  if (!best_uci) return null;
  const san = uciToSan(fenBefore, best_uci);
  return `La mossa era ${san}.`;
}

// ── Board scene state machine types ──────────────────────────────────────────

type SceneState = "start" | "played" | "back" | "best" | "rest";

// How long (ms) after IO intersection before:
//   - the board starts rising     → RISE_DELAY
//   - the replay loop starts      → LOOP_DELAY
// These are tracked in timeoutsRef alongside the animation timeouts.
// PO direction: "rallentalo tantissimo e dagli tempo" — the scene is a moment,
// not a transition. Hold on the table (1200ms), rise very slowly (3400ms in
// CSS, keep in sync), breathe (900ms), then the replay begins.
const RISE_DELAY = 1200;
const LOOP_DELAY = 1200 + 3400 + 900;

// ── Component ─────────────────────────────────────────────────────────────────

interface MomentoDelGiornoProps {
  /** Combined pool: prefer aggregates.cadute, fallback to aggregates.examples. */
  pool: PositionExample[];
  /** Player's goal target rating, used in the Avversario voice line. */
  targetRating: number | null;
}

export function MomentoDelGiorno({ pool, targetRating }: MomentoDelGiornoProps) {
  const nav = useNavigate();
  const momento = selectMomento(pool);

  // ── Derive FEN states for the animation ──────────────────────────────────
  const fenBefore = momento?.fen_before ?? null;
  const playedUci = momento?.played_uci ?? null;
  const bestUci = momento?.best_uci ?? null;

  const fenPlayed = fenBefore && playedUci ? fenAfterUci(fenBefore, playedUci) : null;
  const fenBest = fenBefore && bestUci ? fenAfterUci(fenBefore, bestUci) : null;

  // Can we run the animation?
  const canAnimate = fenBefore != null && fenPlayed != null && fenBest != null;

  // ── 3-D rise state — board lifts from table to flat overhead view ────────
  // risen=true when rotateX(52deg) → rotateX(0): happens RISE_DELAY after IO.
  // Stays true = false only on reduced-motion or canAnimate=false.
  const [risen, setRisen] = useState(false);

  // ── Board animation state machine ────────────────────────────────────────
  const [scene, setScene] = useState<SceneState>("start");
  const cycleRef = useRef(0);
  const startedRef = useRef(false);
  // Guards against setState from a timer that fired in the same tick as unmount.
  const disposedRef = useRef(false);
  // All pending timeouts are tracked so we can cancel them on cleanup.
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearAllTimeouts() {
    for (const id of timeoutsRef.current) clearTimeout(id);
    timeoutsRef.current = [];
  }

  function push(id: ReturnType<typeof setTimeout>) {
    timeoutsRef.current.push(id);
  }

  // Intersection observer to start animation on viewport entry.
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!canAnimate || prefersReducedMotion()) {
      // No animation: show final (risen) state immediately.
      setRisen(true);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !startedRef.current) {
          startedRef.current = true;
          io.disconnect();
          // Coreography: IO fires → board rises (RISE_DELAY) → loop starts (LOOP_DELAY).
          push(setTimeout(() => {
            if (!disposedRef.current) setRisen(true);
          }, RISE_DELAY));
          push(setTimeout(() => {
            if (!disposedRef.current) startCycle();
          }, LOOP_DELAY));
        }
      },
      { threshold: 0.3 },
    );
    io.observe(container);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAnimate, fenBefore]);

  // Cleanup all timeouts on unmount or when the position identity changes.
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      clearAllTimeouts();
      cycleRef.current = 0;
      startedRef.current = false;
      setRisen(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fenBefore]);

  /**
   * Runs one animation cycle and schedules the next until MAX_CYCLES.
   * Timings: start(0) → played(800ms) → back(+1600ms) → best(+500ms) → next(+2000ms).
   * After MAX_CYCLES → rest state.
   * All setTimeout ids are tracked for rigorous cleanup.
   */
  function startCycle() {
    const MAX_CYCLES = 3;
    // Cumulative offsets within this cycle:
    //   t=0:    start
    //   t=800:  played
    //   t=2400: back   (800+1600)
    //   t=2900: best   (2400+500)
    //   t=4900: end of cycle / start next cycle (2900+2000)
    function cycle() {
      if (disposedRef.current) return;
      if (cycleRef.current >= MAX_CYCLES) {
        setScene("rest");
        return;
      }
      setScene("start");
      const safeSet = (s: SceneState) => {
        if (!disposedRef.current) setScene(s);
      };
      push(setTimeout(() => safeSet("played"), 800));
      push(setTimeout(() => safeSet("back"),   800 + 1600));
      push(setTimeout(() => safeSet("best"),   800 + 1600 + 500));
      push(setTimeout(() => {
        cycleRef.current += 1;
        cycle();
      }, 800 + 1600 + 500 + 2000));
    }
    cycle();
  }

  if (!momento) return null;

  // ── Arrow selection based on scene ───────────────────────────────────────
  const arrowPlayed = uciToArrow(momento.played_uci, "rgba(239,68,68,0.85)");
  const arrowBest = uciToArrow(momento.best_uci ?? null, "rgba(34,197,94,0.85)");

  let boardFen: string = momento.fen_before;
  let boardArrows: { from: string; to: string; color: string }[] = [];

  if (!canAnimate || prefersReducedMotion()) {
    // Static: show both arrows on fen_before
    boardFen = momento.fen_before;
    boardArrows = [arrowPlayed, arrowBest].filter(
      Boolean,
    ) as { from: string; to: string; color: string }[];
  } else {
    switch (scene) {
      case "start":
      case "back":
        boardFen = momento.fen_before;
        boardArrows = [];
        break;
      case "played":
        boardFen = fenPlayed!;
        boardArrows = arrowPlayed ? [arrowPlayed] : [];
        break;
      case "best":
        boardFen = fenBest!;
        boardArrows = arrowBest ? [arrowBest] : [];
        break;
      case "rest":
        boardFen = momento.fen_before;
        boardArrows = [arrowPlayed, arrowBest].filter(
          Boolean,
        ) as { from: string; to: string; color: string }[];
        break;
    }
  }

  // Stable resetKey: board remounts only when the position identity changes,
  // not on each scene change (pieces PLANE between FEN transitions via animate).
  const resetKey = `momento:${momento.fen_before}`;

  // Voice triplet
  const tempoLine = buildTempoLine(momento.spent_seconds);
  const avversarioLine = buildAvversarioLine(
    momento.p_target_plays_best_sf,
    momento.p_mine_plays_best_sf,
    targetRating,
  );
  const bestMoveLine = buildBestMoveLine(momento.fen_before, momento.best_uci);
  const hasVoice = tempoLine || avversarioLine || bestMoveLine;

  // La scena del legno: the board rests on wood, no card chrome.
  // One contact shadow only below the board — physical, not decorative.
  return (
    <div
      ref={containerRef}
      role="button"
      tabIndex={0}
      onClick={() => nav("/sessione", { state: { focusKey: `${momento.fen_before}:${momento.ply}` } })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") nav("/sessione", { state: { focusKey: `${momento.fen_before}:${momento.ply}` } });
      }}
      style={{
        cursor: "pointer",
        transition: "opacity 160ms cubic-bezier(0.23,1,0.32,1)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "0.88"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
    >
      {/* Eyebrow */}
      <div className="tt-eyebrow" style={{ marginBottom: "1rem" }}>
        Il momento di oggi
      </div>

      {/* Board + voice side by side on wider screens */}
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* Board column: 3-D scene — board tilted on the table, rises to overhead */}
        <div style={{ flexShrink: 0 }}>
          <div className="momento-scene">
            {/* Prospective tabletop — visible in the gap below the tilted board */}
            <div className="momento-tabletop" aria-hidden="true" />
            {/* Board with contact shadow; tilts 52° until risen=true */}
            <div className={`momento-board-rise${risen ? " risen" : ""}`}>
              <div
                className="momento-board-wrap"
                style={{ boxShadow: "0 10px 24px -12px rgba(0,0,0,0.5)" }}
              >
                <BoardView
                  key={resetKey}
                  fen={boardFen}
                  orientation={momento.color}
                  size={220}
                  arrows={boardArrows}
                  animate={true}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Voice + meta — free text on the wall, no box */}
        <div style={{ flex: 1, minWidth: "180px", paddingTop: "0.25rem" }}>
          {/* Phase chip */}
          <div style={{ marginBottom: "0.75rem" }}>
            <span
              className="tt-chip"
              style={{
                background: "rgba(96,165,250,0.1)",
                color: "var(--color-info, #60a5fa)",
                textTransform: "capitalize",
              }}
            >
              {momento.phase}
            </span>
          </div>

          {/* Voice triplet */}
          {hasVoice && (
            <div
              style={{
                fontSize: "0.88rem",
                lineHeight: 1.65,
                color: "var(--color-text-soft)",
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
              }}
            >
              {/* a) tempo */}
              {tempoLine && (
                <p style={{ margin: 0, color: "var(--color-text-soft)" }}>
                  {tempoLine}
                </p>
              )}

              {/* b) Avversario — twilight tint when drill_value data present */}
              {avversarioLine && (
                <p
                  style={{
                    margin: 0,
                    color: momento.drill_value != null
                      ? "var(--color-brand-soft)"
                      : "var(--color-text-soft)",
                  }}
                >
                  {avversarioLine}
                </p>
              )}

              {/* c) best move — mono */}
              {bestMoveLine && (
                <p style={{ margin: 0, color: "var(--color-text)" }}>
                  <span className="font-mono" style={{ fontWeight: 600 }}>
                    {bestMoveLine}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Subtle CTA hint */}
          <div
            style={{
              marginTop: "1.25rem",
              fontSize: "0.72rem",
              color: "var(--color-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Sediamoci su questa
          </div>
        </div>
      </div>
    </div>
  );
}
