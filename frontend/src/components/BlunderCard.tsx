import type { BlunderRow } from "../types";
import { BoardView } from "./BoardView";
import { squaresOfSan, fmtEval, turnFromFen } from "../chess-utils";

interface Props {
  blunder: BlunderRow;
  size?: number;
}

const MOTIF_COLOR: Record<string, string> = {
  allowed_mate: "#ef4444",
  material_loss: "#fb923c",
  winning_to_lost: "#f59e0b",
  winning_advantage_thrown: "#facc15",
  positional_blunder: "#a18bff",
};

export function BlunderCard({ blunder, size = 280 }: Props) {
  const fen = blunder.fen_before || "";
  const played = fen && blunder.san ? squaresOfSan(fen, blunder.san) : null;
  const best = fen && blunder.best_san ? squaresOfSan(fen, blunder.best_san) : null;
  const orientation = blunder.my_color || turnFromFen(fen);

  const highlights = [
    ...(played
      ? [
          { square: played.from, color: "#ef444466" },
          { square: played.to, color: "#ef4444" },
        ]
      : []),
    ...(best
      ? [
          { square: best.from, color: "#22c55e66" },
          { square: best.to, color: "#22c55e" },
        ]
      : []),
  ];

  const arrows = [
    ...(played
      ? [{ from: played.from, to: played.to, color: "#ef4444" }]
      : []),
    ...(best && best.from !== played?.from
      ? [{ from: best.from, to: best.to, color: "#22c55e" }]
      : []),
  ];

  return (
    <div className="card !p-4 flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">
            {blunder.date} · {blunder.time_class} · {blunder.my_color}
          </div>
          <div className="text-sm text-slate-300 truncate mt-0.5">
            vs <span className="text-slate-100 font-medium">{blunder.opp_rating ?? "?"}</span>
            {blunder.opening ? <> · <span className="text-slate-400">{blunder.opening}</span></> : null}
          </div>
        </div>
        {blunder.motif && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-md whitespace-nowrap"
            style={{
              background: `${MOTIF_COLOR[blunder.motif] || "#a18bff"}22`,
              color: MOTIF_COLOR[blunder.motif] || "#a18bff",
              border: `1px solid ${MOTIF_COLOR[blunder.motif] || "#a18bff"}55`,
            }}
          >
            {blunder.motif_label || blunder.motif}
          </span>
        )}
      </div>

      <div className="flex justify-center">
        <BoardView fen={fen} size={size} orientation={orientation} highlights={highlights} arrows={arrows} />
      </div>

      <div className="mt-3 text-sm">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-slate-400">Mossa {blunder.move_number}</span>
          <span className="text-red-300 font-mono font-semibold">{blunder.san}</span>
          <span className="text-slate-500 text-xs">
            ({fmtEval(blunder.cp_before)} → {fmtEval(blunder.cp_after)}, perdita {blunder.cp_loss}cp)
          </span>
        </div>
        {blunder.best_san && (
          <div className="flex items-baseline gap-2 flex-wrap mt-1.5">
            <span className="text-slate-400">Meglio:</span>
            <span className="text-green-300 font-mono font-semibold">{blunder.best_san}</span>
            {blunder.pv_san.length > 1 && (
              <span className="text-slate-500 text-xs font-mono">
                {blunder.pv_san.slice(0, 5).join(" ")}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-auto pt-3 flex items-center justify-between text-xs">
        <span className="text-slate-500">{blunder.phase}</span>
        {blunder.url && (
          <a
            href={blunder.url}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--color-brand-soft)] hover:underline"
          >
            Apri su Chess.com →
          </a>
        )}
      </div>
    </div>
  );
}
