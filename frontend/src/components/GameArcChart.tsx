/**
 * GameArcChart — "Qualita' lungo la partita"
 *
 * Mostra, per ogni fase (apertura / mediogioco / finale), quanta parte degli
 * errori e' marcata `avoidable_at_current`: alla portata oggi secondo il
 * criterio esplicito Maia. Non e' una frequenza umana calibrata.
 *
 * Dati: MaiaWeighted.by_phase_avoidable (chiavi in italiano).
 * Graceful: se il dato manca o e' vuoto, il componente non si renderizza.
 *
 * Design: flat, palette notturna var(--color-*), numeri in mono,
 * barre HTML senza dipendenze aggiuntive (niente recharts qui — serve
 * semplicita', non un grafico composto). Rispetta DESIGN.md: niente ombre
 * decorative, niente card-dentro-card, niente gradient-text.
 */

import type { MaiaWeighted } from "../pipeline/aggregate";
import { NonnoExplain } from "./NonnoExplain";
import { tr } from "../i18n/lang";

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface PhaseRow {
  label: string;      // etichetta display italiana
  key: string;        // chiave in by_phase_avoidable
  order: number;
}

const PHASE_ORDER: PhaseRow[] = [
  { label: "Apertura", key: "apertura", order: 0 },
  { label: "Mediogioco", key: "mediogioco", order: 1 },
  { label: "Finale", key: "finale", order: 2 },
];

// ── Palette locale (tone-per-share) ──────────────────────────────────────────

function toneForShare(share: number): { bar: string; label: string } {
  // share = avoidable / errors (0..1)
  if (share >= 0.55) return { bar: "var(--color-danger)", label: "var(--color-danger)" };
  if (share >= 0.35) return { bar: "var(--color-warn, #f5a524)", label: "var(--color-warn, #f5a524)" };
  return { bar: "var(--color-brand-soft)", label: "var(--color-brand-soft)" };
}

// ── Componente principale ─────────────────────────────────────────────────────

interface GameArcChartProps {
  maiaWeighted: MaiaWeighted;
}

export function GameArcChart({ maiaWeighted }: GameArcChartProps) {
  const { by_phase_avoidable } = maiaWeighted;

  // Filtra solo le fasi con almeno un errore
  const rows = PHASE_ORDER
    .map((ph) => {
      const entry = by_phase_avoidable[ph.key];
      if (!entry || entry.errors === 0) return null;
      const share = entry.errors > 0 ? entry.avoidable / entry.errors : 0;
      return {
        label: ph.label,
        key: ph.key,
        errors: entry.errors,
        avoidable: entry.avoidable,
        share,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return null;

  const maxErrors = Math.max(...rows.map((r) => r.errors));

  return (
    <div className="surface surface-padded mb-6">

      {/* Intestazione */}
      <div className="mb-5">
        <div className="label-eyebrow mb-1" style={{ color: "var(--color-muted)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          ARCO DELLA PARTITA
          <NonnoExplain
            title={tr("Le tre fasi", "The three phases")}
            lines={[
              tr(
                "Qui vedi in quale fase perdi di piu': apertura, mediogioco o finale.",
                "Here you see where you lose the most: opening, middlegame, or endgame.",
              ),
              tr(
                "La barra colorata mostra gli errori con supporto Maia al livello attuale sulle alternative accettabili osservate. E' un segnale relativo, non una probabilita' calibrata.",
                "The coloured bar shows errors with current-level Maia support on the observed acceptable alternatives. It is a relative signal, not a calibrated probability.",
              ),
            ]}
          />
        </div>
        <div
          style={{
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "var(--color-text)",
            lineHeight: 1.3,
            letterSpacing: "-0.01em",
          }}
        >
          {tr("Supporto Maia attuale per fase", "Current-level Maia support by phase")}
        </div>
        <div
          className="mt-1"
          style={{ fontSize: "0.82rem", color: "var(--color-text-soft)", lineHeight: 1.5 }}
        >
          {tr(
            "Per ogni fase: quanti errori sono stati osservati e quanti hanno il segnale di supporto Maia al livello attuale.",
            "For each phase: observed errors and how many carry the current-level Maia support signal.",
          )}
        </div>
      </div>

      {/* Barre per fase */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.125rem" }}>
        {rows.map((row) => {
          const tone = toneForShare(row.share);
          // Barra totale errori proporzionale al max
          const totalBarPct = maxErrors > 0 ? (row.errors / maxErrors) * 100 : 0;
          // Barra evitabili sovrapposta, proporzionale alla stessa scala
          const avoidBarPct = maxErrors > 0 ? (row.avoidable / maxErrors) * 100 : 0;

          const avoidPct = Math.round(row.share * 100);

          return (
            <div key={row.key}>
              {/* Label row */}
              <div
                className="flex items-baseline justify-between mb-1.5"
                style={{ gap: "0.5rem" }}
              >
                <span
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--color-text-soft)",
                    minWidth: "5rem",
                  }}
                >
                  {row.label}
                </span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--color-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.avoidable}/{row.errors} {tr("con supporto policy current", "with current-policy support")}
                </span>
              </div>

              {/* Track */}
              <div
                style={{
                  position: "relative",
                  height: "10px",
                  borderRadius: "999px",
                  background: "rgba(255,255,255,0.05)",
                  overflow: "hidden",
                }}
              >
                {/* Barra totale errori (sfondo, opaca) */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: `${totalBarPct}%`,
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.08)",
                    transition: "width 600ms cubic-bezier(0.22,1,0.36,1)",
                  }}
                />
                {/* Barra errori evitabili (primo piano, colorata) */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: `${avoidBarPct}%`,
                    borderRadius: "999px",
                    background: tone.bar,
                    opacity: 0.85,
                    transition: "width 700ms cubic-bezier(0.22,1,0.36,1)",
                  }}
                />
              </div>

              {/* Percentuale evitabili */}
              <div
                className="mt-1 font-mono"
                style={{
                  fontSize: "0.7rem",
                  color: tone.label,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {avoidPct}% {tr("con supporto Maia attuale", "with current-level Maia support")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legenda minima */}
      <div
        className="mt-5 pt-4 font-mono"
        style={{
          borderTop: "1px solid var(--color-line)",
          fontSize: "0.68rem",
          color: "var(--color-muted)",
          lineHeight: 1.6,
        }}
      >
        {tr(
          "Barra chiara = errori osservati nella fase. Barra colorata = errori con `avoidable_at_current`. La quota ordina il materiale da rivedere; non promette punti Elo.",
          "Light bar = observed errors in the phase. Coloured bar = errors with `avoidable_at_current`. The share orders review material; it does not promise Elo points.",
        )}
      </div>

    </div>
  );
}
