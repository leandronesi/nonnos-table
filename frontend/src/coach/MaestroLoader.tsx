/**
 * MaestroLoader.tsx — placeholder sobrio mentre la lezione del maestro carica.
 *
 * Tre puntini che respirano per opacity, sfasati di ~200ms ciascuno.
 * Stessa dimensione e slot della riga-perche' (0.875rem, lineHeight 1.55):
 * il layout non salta quando il testo arriva.
 *
 * prefers-reduced-motion: puntini statici (opacity fissa a 0.35).
 * Nessun testo, nessuna frase ripetitiva.
 */

import React from "react";

const DOT_STYLE: React.CSSProperties = {
  display: "inline-block",
  width: "0.28rem",
  height: "0.28rem",
  borderRadius: "999px",
  background: "var(--color-text-soft)",
  marginRight: "0.3rem",
  verticalAlign: "middle",
  opacity: 0.15,
};

/**
 * CSS keyframes are injected once via a <style> tag inside the component.
 * No extra file, no dependency on a CSS module.
 */
const KEYFRAMES = `
@keyframes maestroPulse {
  0%   { opacity: 0.15; }
  50%  { opacity: 0.55; }
  100% { opacity: 0.15; }
}
@media (prefers-reduced-motion: reduce) {
  .maestro-dot {
    animation: none !important;
    opacity: 0.35 !important;
  }
}
`;

let _injected = false;

function injectKeyframes() {
  if (_injected || typeof document === "undefined") return;
  _injected = true;
  const style = document.createElement("style");
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

export function MaestroLoader() {
  // Inject once on first render (idempotent)
  injectKeyframes();

  return (
    <p
      aria-hidden="true"
      style={{
        fontSize: "0.875rem",
        lineHeight: 1.55,
        marginTop: "4px",
        marginBottom: 0,
        height: "1.55em", // matches the p height of the lesson text: no layout shift
        display: "flex",
        alignItems: "center",
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="maestro-dot"
          style={{
            ...DOT_STYLE,
            animation: `maestroPulse 1.4s ease-in-out ${i * 200}ms infinite`,
          }}
        />
      ))}
    </p>
  );
}
