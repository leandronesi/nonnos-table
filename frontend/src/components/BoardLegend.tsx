/**
 * BoardLegend — barra didattica sotto la scacchiera che spiega cosa
 * rappresentano le frecce/colori. Sempre visibile durante una fase di sessione
 * o nelle pagine di analisi posizione, per dare contesto immediato al
 * principiante senza ridondanza testuale altrove.
 */

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

const PRESETS: Record<NonNullable<Props["preset"]>, LegendItem[]> = {
  tema: [
    { color: "#fde047", label: "ultima mossa dell'avversario" },
  ],
  warmup: [
    { color: "#fde047", label: "ultima mossa avversario" },
    { color: "#f6c64a", label: "casa di partenza della mossa giusta (aiuto)" },
  ],
  drill: [
    { color: "#fde047", label: "ultima mossa avversario" },
  ],
  play: [
    { color: "#fde047", label: "mossa avversario" },
    { color: "#a18bff", label: "tua mossa" },
  ],
  review: [
    { color: "#fde047", label: "ultima mossa avversario" },
    { color: "#f43f5e", label: "tua mossa (sbagliata)" },
    { color: "#34d399", label: "mossa giusta" },
  ],
};

export function BoardLegend({ items, preset, className = "" }: Props) {
  const data = items ?? (preset ? PRESETS[preset] : []);
  if (data.length === 0) return null;
  return (
    <div className={`board-legend ${className}`} role="note" aria-label="Legenda colori della scacchiera">
      {data.map((it, i) => (
        <span key={i} className="board-legend-item">
          <span className="board-legend-swatch" style={{ background: it.color }} aria-hidden="true" />
          <span className="board-legend-text">{it.label}</span>
        </span>
      ))}
    </div>
  );
}
