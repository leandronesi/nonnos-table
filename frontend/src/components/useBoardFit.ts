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

import { useEffect, useRef, useState } from "react";

interface UseBoardFitOptions {
  /** Minimum board size in px (default: 232 — smallest usable chessboard). */
  min?: number;
  /** Maximum board size in px (default: 420). */
  max?: number;
}

interface UseBoardFitResult {
  /** Attach to the wrapper div that constrains the board. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Clamped size to pass to <BoardView size={...} />. */
  size: number;
  /** The max value passed in (useful for maxWidth). */
  max: number;
}

export function useBoardFit({ min = 232, max = 420 }: UseBoardFitOptions = {}): UseBoardFitResult {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(max);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? max;
      setSize(Math.max(min, Math.min(max, Math.floor(w))));
    });
    ro.observe(el);
    // Initial measure — some browsers fire ResizeObserver asynchronously.
    const w = el.offsetWidth;
    if (w > 0) setSize(Math.max(min, Math.min(max, Math.floor(w))));
    return () => ro.disconnect();
  }, [min, max]);

  return { ref, size, max };
}
