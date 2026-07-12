/**
 * TeachMaia — illustrates a comparison between the player's current level and
 * target level. It intentionally avoids frequencies: Maia's policy output is
 * used as a relative signal, not as a calibrated "players out of N" claim.
 */

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../../lib/motion";
import { tr } from "../../i18n/lang";

export function TeachMaia({ targetRating }: { targetRating?: number }) {
  const [progress, setProgress] = useState(prefersReducedMotion() ? 1 : 0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const duration = 2600;
    const loop = (ts: number) => {
      if (startRef.current == null) startRef.current = ts;
      const elapsed = (ts - startRef.current) % duration;
      setProgress(Math.min(1, elapsed / (duration * 0.72)));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const markerX = 25 + progress * 50;
  const targetLabel =
    targetRating != null && targetRating > 0
      ? String(targetRating)
      : tr("OBIETTIVO", "GOAL");

  return (
    <svg
      viewBox="0 0 120 76"
      role="img"
      aria-label={tr(
        "Maia confronta quanto una scelta e' naturale al livello attuale e al livello obiettivo",
        "Maia compares how natural a choice is at the current and target levels",
      )}
      style={{ width: "100%", maxWidth: "240px", display: "block" }}
    >
      <text
        x="20"
        y="15"
        textAnchor="middle"
        fill="#717892"
        fontSize="6"
        fontFamily="Inter, sans-serif"
        letterSpacing="0.08em"
      >
        {tr("OGGI", "TODAY")}
      </text>
      <text
        x="100"
        y="15"
        textAnchor="middle"
        fill="#a18bff"
        fontSize="6"
        fontFamily="Inter, sans-serif"
        letterSpacing="0.08em"
      >
        {targetLabel}
      </text>

      <line
        x1="20"
        y1="37"
        x2="100"
        y2="37"
        stroke="#2a3158"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="20"
        y1="37"
        x2={markerX}
        y2="37"
        stroke="#7c5cff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="20" cy="37" r="5" fill="#0f1325" stroke="#717892" strokeWidth="1.2" />
      <circle cx="100" cy="37" r="5" fill="#0f1325" stroke="#a18bff" strokeWidth="1.2" />
      <circle cx={markerX} cy="37" r="3.2" fill="#7c5cff" />
      <circle cx={markerX} cy="37" r="6" fill="none" stroke="#7c5cff" strokeWidth="0.8" opacity="0.28" />

      <text
        x="60"
        y="61"
        textAnchor="middle"
        fill="#b6bcd6"
        fontSize="6"
        fontFamily="Inter, sans-serif"
        letterSpacing="0.04em"
      >
        {tr("NATURALEZZA DELLA SCELTA", "MOVE NATURALNESS")}
      </text>
      <text
        x="60"
        y="70"
        textAnchor="middle"
        fill="#717892"
        fontSize="4.8"
        fontFamily="Inter, sans-serif"
      >
        {tr("confronto relativo, non frequenza", "relative comparison, not frequency")}
      </text>
    </svg>
  );
}
