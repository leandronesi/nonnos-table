import type { HeatmapData, Phase } from "../types";

const PHASE_LABEL: Record<Phase, string> = {
  opening: "Apertura",
  middlegame: "Mediogioco",
  endgame: "Finale",
};
const PHASE_COLOR: Record<Phase, string> = {
  opening: "var(--color-opening)",
  middlegame: "var(--color-middle)",
  endgame: "var(--color-endgame)",
};

export function HeatmapChart({ data }: { data: HeatmapData }) {
  const rows: Phase[] = ["opening", "middlegame", "endgame"];
  const allValues = data.data.flatMap((d) => [d.opening, d.middlegame, d.endgame]);
  const max = Math.max(1, ...allValues);

  // Una "vera" heatmap (più informativa di una bar): mossa × fase, intensità = blunder count.
  return (
    <div className="card">
      <div className="card-title">Momento del blunder · heatmap</div>
      <p className="text-slate-400 text-sm mt-1">
        In che fase / numero di mossa crollo. Più scuro = più blunder.
      </p>

      <div className="mt-4 overflow-auto">
        <table className="min-w-[600px] w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-xs text-slate-500 text-left w-28">Fase</th>
              {data.bins.map((b) => (
                <th key={b} className="text-xs text-slate-500 font-normal text-center">
                  mosse {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((ph) => (
              <tr key={ph}>
                <td className="text-sm font-medium" style={{ color: PHASE_COLOR[ph] }}>
                  {PHASE_LABEL[ph]}
                </td>
                {data.data.map((d) => {
                  const v = d[ph];
                  const intensity = v / max;
                  const bg = intensityToColor(intensity, ph);
                  return (
                    <td
                      key={`${ph}-${d.bin}`}
                      className="text-center text-sm tabular-nums rounded-md"
                      style={{
                        backgroundColor: bg,
                        color: intensity > 0.5 ? "#0b0d18" : "var(--color-text)",
                        height: 44,
                        minWidth: 64,
                        border: "1px solid var(--color-line)",
                      }}
                      title={`${PHASE_LABEL[ph]} · mosse ${d.bin}: ${v} blunder`}
                    >
                      {v || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500 mt-3">
        Scala 0 → {max} blunder. Le righe sono ordinate per fase di gioco; le colonne sono intervalli di numeri di mossa.
      </div>
    </div>
  );
}

function intensityToColor(t: number, phase: Phase): string {
  if (t === 0) return "rgba(255,255,255,0.02)";
  const palette: Record<Phase, [number, number, number]> = {
    opening: [96, 165, 250],
    middlegame: [245, 158, 11],
    endgame: [244, 114, 182],
  };
  const [r, g, b] = palette[phase];
  // alpha sale da 0.18 a 0.95 con t
  const a = 0.18 + t * 0.77;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}
