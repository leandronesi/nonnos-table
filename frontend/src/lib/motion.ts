/**
 * motion.ts — La Stanza motion core
 *
 * Four primitives used by waves B/C for animation.
 * All respect prefers-reduced-motion.
 *
 * Exports:
 *   prefersReducedMotion()       — matchMedia check, safe in Vite (no SSR)
 *   useCountUp(target, duration) — rAF count-up with ease-out cubic
 *   useInkDraw()                 — IntersectionObserver once, callback ref
 *   navigateWithTransition(fn)   — View Transition API wrapper
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { flushSync } from "react-dom";

// ── prefersReducedMotion ──────────────────────────────────────────────────────

/**
 * Returns true if the user has requested reduced motion.
 * Evaluated at call time — safe for Vite (no SSR).
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// ── useCountUp ────────────────────────────────────────────────────────────────

/**
 * Animates a number from its previous value to `target` using rAF.
 * Easing: ease-out cubic — 1 - (1 - t)^3.
 * `from` (optional) is the starting value for the FIRST animation at mount:
 * pass it to make the number travel a meaningful distance (e.g. the rating
 * counts from where the journey started to where it is today). Without it,
 * mount is instant and only later target changes animate.
 * With reduced-motion returns target immediately.
 * Returns Math.round(current).
 */
export function useCountUp(target: number, durationMs = 900, from?: number): number {
  const [value, setValue] = useState(from ?? target);
  const startRef = useRef(from ?? target);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }

    const from = startRef.current;
    startTimeRef.current = null;

    function tick(now: number) {
      if (startTimeRef.current === null) {
        startTimeRef.current = now;
      }
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / durationMs, 1);
      // ease-out cubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      setValue(Math.round(current));
      startRef.current = Math.round(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
        startRef.current = target;
      }
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}

// ── useInkDraw ────────────────────────────────────────────────────────────────

/**
 * Returns a callback ref and a `drawn` boolean.
 * When the element enters the viewport (threshold 0.3), drawn becomes true
 * and the observer disconnects (fires once).
 * With reduced-motion drawn is true from mount.
 *
 * Usage:
 *   const { ref, drawn } = useInkDraw();
 *   <svg className={drawn ? "ink-drawn" : ""}>
 *     <path ref={ref} pathLength={1} className="ink-path" ... />
 *   </svg>
 *
 * Note: callback ref (not RefObject) — same pattern as the b10ee1a fix for
 * useBoardFit, which discovered that RefObject misses re-observation after
 * a keyed remount. A callback ref fires whenever the node attaches/detaches.
 */
export function useInkDraw(): { ref: React.RefCallback<Element>; drawn: boolean } {
  const [drawn, setDrawn] = useState(() => prefersReducedMotion());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: Element | null) => {
    // Disconnect any previous observer when the node changes.
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;
    if (prefersReducedMotion()) {
      setDrawn(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setDrawn(true);
          observer.disconnect();
          observerRef.current = null;
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return { ref, drawn };
}

// ── navigateWithTransition ────────────────────────────────────────────────────

/**
 * Wraps a navigation callback in the View Transition API when available.
 * Falls back to a direct call when:
 *   - document.startViewTransition is not supported
 *   - prefers-reduced-motion is active
 *
 * Defensive: if flushSync inside a transition throws (e.g. already inside a
 * React update), falls back to a direct fn() call.
 *
 * Usage:
 *   navigateWithTransition(() => navigate("/sessione"));
 */
export function navigateWithTransition(fn: () => void): void {
  const canTransition =
    typeof document !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (document as any).startViewTransition === "function" &&
    !prefersReducedMotion();

  if (!canTransition) {
    fn();
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document as any).startViewTransition(() => {
      try {
        flushSync(fn);
      } catch {
        // flushSync threw inside a transition (e.g. concurrent mode edge case).
        // Execute directly as a safe fallback.
        fn();
      }
    });
  } catch {
    // startViewTransition threw for any reason — call fn directly.
    fn();
  }
}
