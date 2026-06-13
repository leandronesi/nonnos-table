/**
 * TeachMaia — illustrazione didattica "Quello che trova uno come te".
 * Otto segnalini (i giocatori al tuo livello): UNO solo si accende.
 * Messaggio: "1 su 8 a 1500". SVG + CSS, nessuna libreria esterna.
 */

import { useEffect, useRef, useState } from "react";
import { tr } from "../../i18n/lang";

const CX = 50;
const CY = 50;
const R = 30;
const START = 200; // gradi
const SPAN = 140;
const N = 8;
const LIT = 3; // quale degli otto si accende

function pip(i: number) {
  const deg = START + (SPAN * i) / (N - 1);
  const rad = (deg * Math.PI) / 180;
  return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
}

export function TeachMaia({ targetRating }: { targetRating?: number }) {
  const [t, setT] = useState(0); // 0..1 nel ciclo
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const DURATION = 4200;

  useEffect(() => {
    const loop = (ts: number) => {
      if (startRef.current == null) startRef.current = ts;
      setT(((ts - startRef.current) % DURATION) / DURATION);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Fasi: 0-0.40 i pip appaiono; 0.40-0.65 si accende l'uno; resto hold + pulse lento.
  const appear = Math.min(1, t / 0.4);
  const litT = Math.max(0, Math.min(1, (t - 0.4) / 0.25));
  const lit = litT > 0;
  const pulse = lit ? 1 + 0.12 * Math.sin((t - 0.4) * Math.PI * 3) : 1;

  return (
    <svg
      viewBox="0 0 100 80"
      aria-hidden="true"
      style={{ width: "100%", maxWidth: "220px", display: "block" }}
    >
      {/* Gli otto giocatori al tuo livello */}
      {Array.from({ length: N }, (_, i) => {
        const p = pip(i);
        const isLit = i === LIT && lit;
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={isLit ? 3 * pulse : 2}
            fill={isLit ? "#7c5cff" : "#2a3158"}
            opacity={isLit ? 1 : 0.3 + appear * 0.4}
            style={{ transition: "fill 300ms cubic-bezier(0.23,1,0.32,1)" }}
          />
        );
      })}

      {/* Alone sul pip acceso */}
      {lit && (
        <circle
          cx={pip(LIT).x}
          cy={pip(LIT).y}
          r={6 * pulse}
          fill="none"
          stroke="#7c5cff"
          strokeWidth="0.8"
          opacity="0.3"
        />
      )}

      {/* Centro: 1 su 8 */}
      <text
        x={CX}
        y={CY + 2}
        textAnchor="middle"
        fill="#eef0fa"
        fontSize="14"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        opacity={lit ? 1 : 0.25}
      >
        1
      </text>
      <text
        x={CX}
        y={CY + 12}
        textAnchor="middle"
        fill="#717892"
        fontSize="6"
        fontFamily="JetBrains Mono, monospace"
      >
        {tr("su 8", "in 8")}
      </text>

      {/* Livello */}
      <text
        x={CX}
        y={73}
        textAnchor="middle"
        fill="#a18bff"
        fontSize="5.5"
        fontFamily="Inter, sans-serif"
        letterSpacing="0.1em"
      >
        {targetRating != null && targetRating > 0
          ? tr(`a ${targetRating}`, `at ${targetRating}`)
          : tr("al tuo livello", "at your level")}
      </text>
    </svg>
  );
}
