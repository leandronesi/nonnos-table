/**
 * TeachTime — illustrazione didattica "Il tempo che ti tradisce".
 * Un orologio (barra) che si svuota mentre il vantaggio resta alto;
 * quando l'orologio entra in rosso, la linea precipita.
 * SVG + CSS, nessuna libreria esterna.
 */

import { useEffect, useRef, useState } from "react";

export function TeachTime() {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const DURATION = 3600; // ms per ciclo completo

  useEffect(() => {
    const loop = (ts: number) => {
      if (startRef.current == null) startRef.current = ts;
      const elapsed = (ts - startRef.current) % DURATION;
      setTick(elapsed / DURATION);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // t = 0..1 nel ciclo. Orologio si svuota linearmente.
  // Vantaggio: stabile fino a t=0.68, poi precipita.
  const timeLeft = Math.max(0, 1 - tick); // 1..0

  const advantageY = (t: number): number => {
    if (t < 0.68) return 0.15; // linea alta (15% dall'alto del grafico)
    // dopo 0.68, precipita in 0.32
    const drop = (t - 0.68) / 0.32;
    return 0.15 + drop * drop * 0.7; // quadratica verso il basso
  };
  const advY = advantageY(tick);

  // 24 punti per la linea del vantaggio
  const linePoints = Array.from({ length: 24 }, (_, i) => {
    const t = i / 23;
    // per i punti "futuri" (i > tick*23) non ancora calcolati, mostra piatto
    const effectiveT = Math.min(t, tick);
    return { x: 8 + t * 84, y: advantageY(effectiveT) * 60 + 8 };
  });
  const polyline = linePoints.map((p) => `${p.x},${p.y}`).join(" ");

  // Colore dell'orologio
  const isRed = timeLeft < 0.25;
  const clockColor = isRed ? "#f43f5e" : timeLeft < 0.5 ? "#f5a524" : "#34d399";

  return (
    <svg
      viewBox="0 0 100 80"
      aria-hidden="true"
      style={{ width: "100%", maxWidth: "220px", display: "block" }}
    >
      {/* Sfondo micro-grafico */}
      <rect x="4" y="4" width="92" height="64" rx="5" fill="#1c2138" />

      {/* Griglia orizzontale */}
      {[20, 40, 60].map((y) => (
        <line key={y} x1="8" y1={y} x2="92" y2={y} stroke="#2a3158" strokeWidth="0.5" />
      ))}

      {/* Linea del vantaggio */}
      <polyline
        points={polyline}
        fill="none"
        stroke="#7c5cff"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Punto corrente sulla linea */}
      {tick > 0 && (
        <circle
          cx={8 + tick * 84}
          cy={advY * 60 + 8}
          r="2.5"
          fill="#7c5cff"
        />
      )}

      {/* Barra orologio in fondo */}
      <rect x="8" y="70" width="84" height="5" rx="2.5" fill="#161a30" />
      <rect
        x="8"
        y="70"
        width={84 * timeLeft}
        height="5"
        rx="2.5"
        fill={clockColor}
        style={{
          transition: "fill 300ms cubic-bezier(0.23,1,0.32,1)",
        }}
      />

      {/* Label orologio */}
      <text
        x="8"
        y="68"
        fill="#717892"
        fontSize="5"
        fontFamily="JetBrains Mono, monospace"
      >
        tempo
      </text>
    </svg>
  );
}
