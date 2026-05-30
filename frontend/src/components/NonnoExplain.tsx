/**
 * NonnoExplain — il Nonno-interprete.
 *
 * Un affordance "?" (bottone tondo discreto) che al click apre/chiude
 * un pannello inline con la spiegazione di Nonno per quel grafico o sezione.
 *
 * Uso:
 *   <NonnoExplain title="Percorso rating" lines={[
 *     "Sei a 1240 oggi, obiettivo 1500.",
 *     "Se vai così arrivi a 1450 entro la scadenza.",
 *   ]} />
 *
 * Il componente è completamente autonomo: nessuna chiamata LLM, tutte
 * le frasi sono template compilati dal chiamante con i dati reali.
 */

import { useState } from "react";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface NonnoExplainProps {
  /** Titolo breve mostrato in cima al pannello espanso. */
  title: string;
  /** Frasi di Nonno, una per riga. Max 4-5 per restare leggibili. */
  lines: string[];
  /** Classe aggiuntiva opzionale per posizionamento (es. "ml-2"). */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NonnoExplain({ title, lines, className = "" }: NonnoExplainProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`inline-block align-middle ${className}`}
      style={{ position: "relative" }}
    >
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Spiega: ${title}`}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "1.25rem",
          height: "1.25rem",
          borderRadius: "999px",
          border: "1px solid rgba(255,255,255,0.15)",
          background: open ? "var(--color-brand-soft)" : "rgba(255,255,255,0.07)",
          color: open ? "var(--color-bg)" : "var(--color-muted)",
          fontSize: "0.65rem",
          fontWeight: 700,
          lineHeight: 1,
          cursor: "pointer",
          transition: "background 180ms ease, color 180ms ease",
          flexShrink: 0,
        }}
      >
        ?
      </button>

      {/* Inline expanded panel */}
      {open && (
        <span
          role="tooltip"
          style={{
            display: "block",
            position: "absolute",
            top: "calc(100% + 0.5rem)",
            left: "50%",
            transform: "translateX(-50%)",
            width: "clamp(220px, 60vw, 340px)",
            zIndex: 50,
            background: "var(--color-surface, #1a1a2e)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "0.75rem",
            padding: "0.875rem 1rem",
          }}
        >
          {/* Arrow up */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "-6px",
              left: "50%",
              transform: "translateX(-50%) rotate(45deg)",
              width: "10px",
              height: "10px",
              background: "var(--color-surface, #1a1a2e)",
              borderLeft: "1px solid rgba(255,255,255,0.1)",
              borderTop: "1px solid rgba(255,255,255,0.1)",
            }}
          />

          {/* Title eyebrow */}
          <span
            style={{
              display: "block",
              fontSize: "0.6rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--color-brand-soft)",
              marginBottom: "0.5rem",
            }}
          >
            Nonno
          </span>

          {/* Lines */}
          {lines.map((line, i) => (
            <p
              key={i}
              style={{
                margin: 0,
                marginBottom: i < lines.length - 1 ? "0.4rem" : 0,
                fontSize: "0.82rem",
                lineHeight: 1.5,
                color: "var(--color-text-soft)",
              }}
            >
              {line}
            </p>
          ))}

          {/* Close button */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              display: "block",
              marginTop: "0.75rem",
              marginLeft: "auto",
              fontSize: "0.7rem",
              color: "var(--color-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            chiudi
          </button>
        </span>
      )}
    </span>
  );
}
