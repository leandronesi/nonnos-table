/**
 * TeachAncora — illustrazione didattica "Una sola ancora".
 * Tanti puntini sparsi che si avvicinano e si fondono in UN punto acceso.
 * SVG + CSS, nessuna libreria esterna.
 */

import { useEffect, useRef, useState } from "react";

// Posizioni iniziali dei puntini (relativi a viewport 100x80)
const DOTS_INITIAL = [
  { x: 15, y: 10 },
  { x: 78, y: 8 },
  { x: 88, y: 35 },
  { x: 72, y: 65 },
  { x: 24, y: 70 },
  { x: 8, y: 42 },
  { x: 42, y: 5 },
  { x: 90, y: 58 },
  { x: 12, y: 22 },
  { x: 60, y: 72 },
  { x: 35, y: 60 },
  { x: 80, y: 20 },
];

const CENTER = { x: 50, y: 40 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ease-out cubic
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function TeachAncora() {
  const [progress, setProgress] = useState(0); // 0..1
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const DURATION = 4600;

  useEffect(() => {
    const loop = (ts: number) => {
      if (startRef.current == null) startRef.current = ts;
      const elapsed = (ts - startRef.current) % DURATION;
      const t = elapsed / DURATION;
      setProgress(t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // 0..0.7 = convergenza, 0.7..1 = pausa sul punto acceso
  const convT = Math.min(1, progress / 0.7);
  const eased = easeOut(convT);

  // Quando convergono quasi del tutto, fondiamo in un punto
  const converged = eased > 0.92;

  return (
    <svg
      viewBox="0 0 100 80"
      aria-hidden="true"
      style={{ width: "100%", maxWidth: "220px", display: "block" }}
    >
      {/* Sfondo */}
      <rect x="2" y="2" width="96" height="76" rx="6" fill="#0f1325" />

      {/* Puntini in movimento */}
      {!converged &&
        DOTS_INITIAL.map((d, i) => {
          const cx = lerp(d.x, CENTER.x, eased);
          const cy = lerp(d.y, CENTER.y, eased);
          const opacity = 0.35 + eased * 0.3;
          const r = 1.8 - eased * 0.8;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="#a18bff"
              opacity={opacity}
            />
          );
        })}

      {/* Punto acceso finale */}
      <circle
        cx={CENTER.x}
        cy={CENTER.y}
        r={converged ? 5 : eased * 3}
        fill="#7c5cff"
        opacity={converged ? 1 : 0.6 + eased * 0.4}
      />

      {/* Alone sul punto convergente */}
      {converged && (
        <circle
          cx={CENTER.x}
          cy={CENTER.y}
          r={10}
          fill="none"
          stroke="#7c5cff"
          strokeWidth="1"
          opacity="0.25"
        />
      )}

      {/* Etichetta */}
      <text
        x={CENTER.x}
        y={72}
        textAnchor="middle"
        fill={converged ? "#a18bff" : "#4a5070"}
        fontSize="5.5"
        fontFamily="Inter, sans-serif"
        fontWeight={converged ? "700" : "400"}
        letterSpacing="0.1em"
        style={{ transition: "fill 600ms cubic-bezier(0.23,1,0.32,1)" }}
      >
        {converged ? "UN'ANCORA" : "tanti segnali"}
      </text>
    </svg>
  );
}
