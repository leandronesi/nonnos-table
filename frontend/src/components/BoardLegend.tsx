/**
 * BoardLegend — barra didattica sotto la scacchiera che spiega cosa
 * rappresentano le frecce/colori. Sempre visibile durante una fase di sessione
 * o nelle pagine di analisi posizione, per dare contesto immediato al
 * principiante senza ridondanza testuale altrove.
 */

import { tr } from "../i18n/lang";

interface LegendItem {
  color: string;
  label: string;
}

interface Props {
  items?: LegendItem[];
  /** Preset: tema (gialla), warmup (gialla+oro hint), drill (gialla), play (gialla+rossa+verde dopo mossa), review (gialla+rossa+verde). */
  preset?: "tema" | "warmup" | "drill" | "play" | "review";
  className?: string;
}

// PRESETS is a getter function, not a module-level const, to avoid freezing
// translated strings at module load time. Called at render time so getLang()
// reads the live language value.
function getPresets(): Record<NonNullable<Props["preset"]>, LegendItem[]> {
  return {
    tema: [
      {
        color: "#fde047",
        label: tr("ultima mossa dell'avversario", "opponent's last move"),
      },
    ],
    warmup: [
      {
        color: "#fde047",
        label: tr("ultima mossa avversario", "opponent's last move"),
      },
      {
        color: "#f6c64a",
        label: tr(
          "casa di partenza della mossa giusta (aiuto)",
          "starting square of the right move (hint)",
        ),
      },
    ],
    drill: [
      {
        color: "#fde047",
        label: tr("ultima mossa avversario", "opponent's last move"),
      },
    ],
    play: [
      {
        color: "#fde047",
        label: tr("mossa avversario", "opponent's move"),
      },
      {
        color: "#a18bff",
        label: tr("tua mossa", "your move"),
      },
    ],
    review: [
      {
        color: "#fde047",
        label: tr("ultima mossa avversario", "opponent's last move"),
      },
      {
        color: "#f43f5e",
        label: tr("tua mossa (sbagliata)", "your move (wrong)"),
      },
      {
        color: "#34d399",
        label: tr("mossa giusta", "right move"),
      },
    ],
  };
}

export function BoardLegend({ items, preset, className = "" }: Props) {
  const presets = getPresets();
  const data = items ?? (preset ? presets[preset] : []);
  if (data.length === 0) return null;
  return (
    <div
      className={`board-legend ${className}`}
      role="note"
      aria-label={tr("Legenda colori della scacchiera", "Board color legend")}
    >
      {data.map((it, i) => (
        <span key={i} className="board-legend-item">
          <span
            className="board-legend-swatch"
            style={{ background: it.color }}
            aria-hidden="true"
          />
          <span className="board-legend-text">{it.label}</span>
        </span>
      ))}
    </div>
  );
}
