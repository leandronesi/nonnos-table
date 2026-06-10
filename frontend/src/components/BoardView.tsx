import { useLayoutEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Color } from "../types";

/**
 * Returns true if the user has requested reduced motion.
 * Evaluated once per module load — safe for Vite (no SSR).
 */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Props {
  fen: string;
  size?: number;
  orientation?: Color;
  /** Square highlights, e.g. for "from" / "to" of the played and best move. */
  highlights?: { square: string; color: string }[];
  /** Arrows: from → to, optional color. */
  arrows?: { from: string; to: string; color?: string }[];
  /** Se vuoi che l'utente possa muovere i pezzi. Drop ritorna true se la mossa è legale/accettata. */
  draggable?: boolean;
  onPieceDrop?: (from: string, to: string, piece: string) => boolean | Promise<boolean>;
  onSquareClick?: (square: string) => void;
  /** Key per forzare re-mount del Chessboard (es. cambio puzzle). Se non passata, usa fen. */
  resetKey?: string;
  /**
   * When true, pieces animate between positions (animationDurationInMs=260).
   * The Chessboard key is then resetKey-only (stable), so position changes do
   * NOT remount — pieces glide instead of snapping.
   * When false (default), behaviour is identical to before this prop existed.
   * Reduced-motion: animation is always 0 regardless of this flag.
   */
  animate?: boolean;
}

export function BoardView({
  fen,
  size = 320,
  orientation = "white",
  highlights,
  arrows,
  draggable = false,
  onPieceDrop,
  onSquareClick,
  resetKey,
  animate = false,
}: Props) {
  // Responsive sizing: measure the available container width and clamp to
  // the requested size so the board never overflows on narrow viewports.
  const wrapRef = useRef<HTMLDivElement>(null);
  const maxSize = typeof size === "number" ? size : 320;
  const [boardSize, setBoardSize] = useState(maxSize);

  useLayoutEffect(() => {
    let raf = 0;
    function measure() {
      const parent = wrapRef.current?.parentElement;
      if (!parent) return;
      const availableWidth = parent.offsetWidth;
      // Ignore implausibly small / transient reads: a flex item that collapsed
      // mid-reflow, or a pre-layout measurement, can report a near-zero width.
      // Applying it would lock the board to a tiny size and keep it there until
      // the next resize — the "a volte piccolissima" bug. A real container is
      // never this narrow (the smallest intentional board is ~160px).
      if (availableWidth < 120) return;
      setBoardSize(Math.min(maxSize, availableWidth));
    }
    measure();
    // Re-measure on the next frame in case layout had not settled at this point.
    raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    const target = wrapRef.current?.parentElement ?? wrapRef.current;
    if (target) ro.observe(target);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [maxSize]);

  const squareStyles: Record<string, React.CSSProperties> = {};
  if (highlights) {
    for (const h of highlights) {
      squareStyles[h.square] = {
        // Riempimento radiale + anello interno: l'anello resta visibile anche
        // quando sulla casa c'e' un pezzo (che copre il centro del gradiente).
        // Cosi' la casa di partenza in oro si vede SEMPRE, anche occupata.
        background: `radial-gradient(circle, ${h.color} 0%, ${h.color}88 55%, transparent 72%)`,
        boxShadow: `inset 0 0 0 3px ${h.color}`,
        boxSizing: "border-box",
      };
    }
  }

  // Determine animation duration: respect reduced-motion regardless of animate prop.
  const animDuration = (animate && !prefersReducedMotion()) ? 260 : 0;

  // Key strategy:
  //   animate=true  → key is resetKey only (stable across FEN changes, pieces glide)
  //   animate=false → key is resetKey ?? fen (remount on every FEN change, original behaviour)
  const boardKey = animate ? (resetKey ?? "board") : (resetKey ?? fen);

  // react-chessboard v5 mantiene gli arrows nel suo state interno quando cambia
  // `position`. Forziamo il reset re-montando il componente con una key dipendente
  // dal FEN, e usiamo anche le opzioni dedicate alla pulizia.
  return (
    <div
      ref={wrapRef}
      style={{ width: boardSize, height: boardSize }}
      role="img"
      aria-label="Scacchiera"
    >
      <Chessboard
        key={boardKey}
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: draggable,
          showNotation: true,
          clearArrowsOnPositionChange: true,
          clearArrowsOnClick: true,
          animationDurationInMs: animDuration,
          // Board colours via CSS custom properties — resolves to computed style.
          // var() works in inline styles: the browser resolves them before painting.
          darkSquareStyle: { backgroundColor: "var(--board-dark)" },
          lightSquareStyle: { backgroundColor: "var(--board-light)" },
          boardStyle: {
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
          },
          squareStyles,
          arrows: (arrows || []).map((a) => ({
            startSquare: a.from,
            endSquare: a.to,
            color: a.color || "#22c55e",
          })),
          onSquareClick: onSquareClick ? ({ square }) => onSquareClick(square) : undefined,
          onPieceDrop: onPieceDrop
            ? ({ sourceSquare, targetSquare, piece }) => {
                if (!sourceSquare || !targetSquare) return false;
                const result = onPieceDrop(
                  sourceSquare,
                  targetSquare,
                  (piece as unknown as { pieceType?: string })?.pieceType || "",
                );
                if (typeof result === "boolean") return result;
                // async case: ritorniamo true per accettare l'animazione, l'aggiornamento
                // della posizione avverrà dal parent component
                return true;
              }
            : undefined,
        }}
      />
    </div>
  );
}
