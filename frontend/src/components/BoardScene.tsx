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

interface BoardSceneProps {
  /** Identity key: when this changes the entrance animation re-runs. */
  sceneKey: string;
  /** Delay in ms before the rise starts. Default 500. */
  holdMs?: number;
  children: React.ReactNode;
}

export function BoardScene({ children, sceneKey, holdMs = 500 }: BoardSceneProps) {
  // With reduced-motion start already risen so no transition ever fires.
  const [risen, setRisen] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) {
      setRisen(true);
      return;
    }

    // Each new sceneKey triggers a fresh entrance.
    setRisen(false);

    const t = setTimeout(() => {
      setRisen(true);
    }, holdMs);

    return () => clearTimeout(t);
  }, [sceneKey, holdMs]);

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
