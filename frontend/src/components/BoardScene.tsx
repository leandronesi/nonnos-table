/**
 * BoardScene — a chessboard arrives lying on the wooden table and rises
 * to the overhead view. Reusable wrapper around any board container.
 *
 * Props:
 *   sceneKey  — re-runs the entrance when the position identity changes.
 *               Pass a FEN or a stable position id.
 *   holdMs    — delay (ms) between mount and the rise starting. Default 500.
 *               Kept intentionally shorter than MomentoDelGiorno (1200ms)
 *               because in Sessione the ritual repeats per position.
 *
 * Interaction is blocked (pointerEvents: none) until risen=true.
 * drag coordinates inside a rotated element would be wrong otherwise.
 *
 * Reduced-motion: risen is set to true immediately, no transition runs.
 * The CSS also disables the transition via the @media rule in index.css.
 *
 * CSS classes used:
 *   .board-scene           — perspective container
 *   .board-scene-tabletop  — prospective wooden plane (aria-hidden)
 *   .board-scene-rise      — wrapper animated from rotateX(48deg) to 0
 *   .board-scene-rise.risen — final overhead state
 *
 * See: index.css, section "── BoardScene — session entry". Cross-reference
 * with .momento-scene/.momento-board-rise which use 3400ms (daily one-shot).
 */

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "../lib/motion";

// Session-scoped "already sat down" flag. The board rise is the ritual of
// sitting at the table: it should play once when you arrive at a session, not
// at every phase change. NonnoSession calls resetBoardSceneRitual() at the
// start of each session; the first board to rise (or a morph arrival) spends
// it, and every later board in that session is simply already up.
// BoardScene is only used inside the session, so this module flag is safe.
let ritualSpent = false;
export function resetBoardSceneRitual() {
  ritualSpent = false;
}

interface BoardSceneProps {
  /** Identity key: when this changes the entrance animation re-runs. */
  sceneKey: string;
  /** Delay in ms before the rise starts. Default 500. */
  holdMs?: number;
  /**
   * If true, the board starts already risen (no entrance animation).
   * Used when the board arrives via a View Transition morph from the Tavolo:
   * the VT already carried the object, a second rise would be a double entrance.
   * Only applies on the FIRST mount of this sceneKey — subsequent sceneKey
   * changes (e.g. phase restart) always run the full entrance.
   */
  startRisen?: boolean;
  children: React.ReactNode;
}

export function BoardScene({ children, sceneKey, holdMs = 500, startRisen = false }: BoardSceneProps) {
  // Already up if: reduced motion, a morph arrival, or this session's one rise
  // is already spent (a later phase). Otherwise this is the sit-down ritual.
  const reduced = prefersReducedMotion();
  const [risen, setRisen] = useState(() => reduced || startRisen || ritualSpent);

  useEffect(() => {
    if (reduced || startRisen) {
      // Morph arrival (or reduced motion) counts as the sit-down: spend it so
      // the following phases in this session do not rise again.
      setRisen(true);
      ritualSpent = true;
      return;
    }
    if (ritualSpent) {
      // Already sat down earlier in this session: the board is simply there.
      setRisen(true);
      return;
    }

    // First board of the session: run the entrance once, then spend the ritual.
    setRisen(false);

    const t = setTimeout(() => {
      setRisen(true);
      ritualSpent = true;
    }, holdMs);

    return () => clearTimeout(t);
  }, [sceneKey, holdMs, startRisen, reduced]);

  return (
    <div className="board-scene">
      {/* Prospective tabletop — visible in the gap below the tilted board */}
      <div className="board-scene-tabletop" aria-hidden="true" />
      {/* Board wrapper; interaction disabled while rotated (drag coords wrong) */}
      <div
        className={`board-scene-rise${risen ? " risen" : ""}`}
        style={{ pointerEvents: risen ? undefined : "none" }}
      >
        {children}
      </div>
    </div>
  );
}
