import type { BlindSpot } from "../types";

const MOTIF_COLOR: Record<string, string> = {
  allowed_mate: "#f43f5e",
  material_loss: "#fb923c",
  winning_to_lost: "#f5a524",
  winning_advantage_thrown: "#facc15",
  positional_blunder: "#a18bff",
};

const MOTIF_LICHESS: Record<string, string> = {
  allowed_mate: "mateIn2",
  material_loss: "hangingPiece",
  winning_to_lost: "endgame",
  winning_advantage_thrown: "middlegame",
  positional_blunder: "middlegame",
};

export function BlindSpotsList({ blind_spots }: { blind_spots: BlindSpot[] }) {
  if (!blind_spots || blind_spots.length === 0) return null;
  const total = blind_spots.reduce((s, b) => s + b.n, 0);
  const max = Math.max(...blind_spots.map((b) => b.n));

  return (
    <div className="surface surface-padded">
      <div className="space-y-5">
        {blind_spots.map((b, i) => {
          const pct = total > 0 ? (b.n / total) * 100 : 0;
          const width = max > 0 ? (b.n / max) * 100 : 0;
          const color = MOTIF_COLOR[b.motif] || "#a18bff";
          const theme = MOTIF_LICHESS[b.motif];
          return (
            <div key={b.motif} className="group">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-[color:var(--color-muted)] tabular-nums w-6">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-[var(--font-display)] text-lg font-semibold">{b.label_it}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm tabular-nums" style={{ color }}>
                    {Math.round(pct)}%
                  </span>
                  {theme && (
                    <a
                      href={`https://lichess.org/training/${theme}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-ghost text-[11px] !py-1 !px-2 opacity-0 group-hover:opacity-100 transition"
                    >
                      Lichess →
                    </a>
                  )}
                </div>
              </div>
              <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden ml-9">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${width}%`,
                    background: `linear-gradient(90deg, ${color}33, ${color})`,
                    boxShadow: `0 0 20px -4px ${color}88`,
                  }}
                />
              </div>
              <div className="text-xs text-[color:var(--color-muted)] mt-2 ml-9 font-mono">
                {b.n} blunder · {b.avoidable_count} evitabili alla tua forza · ACPL medio {b.avg_cp_loss}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
