import type { PositionRow, RepertoireOpening } from "../types";
import { cpToHuman } from "../glossary";

/**
 * Repertorio peggiore per colore. Per ogni apertura mostro le 3 posizioni
 * incriminate, cliccabili → si apre PlaySession contro Stockfish per
 * rivivere il bivio.
 *
 * Promessa: "lo so che perdi la Francese, ecco le 3 posizioni che hai
 * sbagliato nelle ultime partite. Rifalle col motore davanti, capisci
 * dove vai male, la prossima partita non ti suicidi al 22imo".
 */
export function RepertoireCard({
  openings,
  onPlay,
  emptyLabel,
}: {
  openings: RepertoireOpening[];
  onPlay: (p: PositionRow) => void;
  emptyLabel?: string;
}) {
  if (!openings || openings.length === 0) {
    return (
      <div className="surface surface-padded">
        <p className="text-sm text-[color:var(--color-text-soft)]">
          {emptyLabel || "Nessuna apertura con abbastanza campioni."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {openings.map((op) => (
        <OpeningBlock key={`${op.eco}-${op.opening}`} op={op} onPlay={onPlay} />
      ))}
    </div>
  );
}

function OpeningBlock({ op, onPlay }: { op: RepertoireOpening; onPlay: (p: PositionRow) => void }) {
  const wr = op.win_rate != null ? Math.round(op.win_rate * 100) : null;
  const wrTone = wr == null ? "" : wr <= 25 ? "#fda4af" : wr <= 45 ? "#fcd34d" : "#a3e635";
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--color-line, rgba(255,255,255,0.08))",
      }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="text-sm font-semibold text-[color:var(--color-text)] leading-snug">
          {op.opening}
        </div>
        <span className="font-mono text-[10px] text-[color:var(--color-muted)]">{op.eco}</span>
      </div>
      <div className="text-[11px] text-[color:var(--color-muted)] tracking-wider uppercase">
        {op.games} partite · win{" "}
        <span style={{ color: wrTone }}>{wr != null ? `${wr}%` : "—"}</span> · ACPL {op.avg_acpl}
      </div>

      <div className="mt-3 space-y-1.5">
        {op.positions.map((p) => {
          const lossLabel = cpToHuman(p.cp_loss);
          return (
            <button
              key={`${p.game_id}:${p.ply}`}
              onClick={() => onPlay(p)}
              className="w-full text-left rounded-lg px-3 py-2 transition flex items-baseline gap-3"
              style={{
                background: "rgba(244, 63, 94, 0.06)",
                border: "1px solid rgba(244, 63, 94, 0.18)",
              }}
            >
              <span className="font-mono text-[11px] text-[color:var(--color-muted)] tabular-nums w-12">
                #{p.move_number}
              </span>
              <span className="flex-1">
                <span className="font-mono text-rose-300 text-sm">{p.san}</span>
                <span className="text-[color:var(--color-muted)] mx-1">→</span>
                <span className="font-mono text-emerald-300 text-sm">{p.best_san_sf || "?"}</span>
              </span>
              <span className="text-[10px] tabular-nums text-rose-300">{lossLabel}</span>
              <span className="text-[10px] text-[color:var(--color-faint)]">▶</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
