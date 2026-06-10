/**
 * useBoardFit — shared hook for responsive board sizing.
 *
 * Measures a container element via ResizeObserver and returns a clamped size.
 * Usage:
 *   const fit = useBoardFit({ min: 232, max: 420 });
 *   <div ref={fit.ref} style={{ width: "100%", maxWidth: fit.max }}>
 *     <BoardView size={fit.size} ... />
 *   </div>
 *
 * The board never overflows its container.
 * Graceful: returns max immediately, then corrects once the element is measured.
 */

import { useEffect, useState } from "react";

interface UseBoardFitOptions {
  /** Minimum board size in px (default: 232 — smallest usable chessboard). */
  min?: number;
  /** Maximum board size in px (default: 420). */
  max?: number;
}

interface UseBoardFitResult {
  /** Attach to the wrapper div that constrains the board. */
  ref: React.RefCallback<HTMLDivElement>;
  /** Clamped size to pass to <BoardView size={...} />. */
  size: number;
  /** The max value passed in (useful for maxWidth). */
  max: number;
}

export function useBoardFit({ min = 232, max = 420 }: UseBoardFitOptions = {}): UseBoardFitResult {
  // Callback ref + state: when the wrapper is re-created (e.g. a keyed remount
  // for an enter animation), the observer must move to the NEW node. A plain
  // RefObject with a run-once effect kept observing the detached element,
  // which reports width 0 and locked the board to `min` ("board piccola").
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState(max);

  useEffect(() => {
    if (!node) return;
    const apply = (w: number) => {
      // Ignore implausibly small / transient reads (detached node, mid-reflow
      // collapse) — same guard as BoardView (see 8ff0e69). A real container
      // is never this narrow.
      if (w < 120) return;
      setSize(Math.max(min, Math.min(max, Math.floor(w))));
    };
    const ro = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(node);
    // Initial measure — some browsers fire ResizeObserver asynchronously.
    apply(node.offsetWidth);
    return () => ro.disconnect();
  }, [node, min, max]);

  return { ref: setNode, size, max };
}
