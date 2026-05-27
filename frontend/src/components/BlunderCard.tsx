import { BoardView } from "./BoardView";
import { squaresOfSan, turnFromFen } from "../chess-utils";
import { cpToHuman, cpToPawns } from "../glossary";
import type { Color, Phase, Result } from "../types";

export interface BlunderRow {
  game_id: string;
  url: string | null;
  date: string | null;
  end_time_epoch?: number | null;
  time_class?: string | null;
  my_color: Color | null;
  my_rating?: number | null;
  opp_rating: number | null;
  result?: Result | null;
  eco: string | null;
  opening: string | null;
  ply: number;
  move_number: number;
  san: string;
  phase: Phase;
  cp_before: number;
  cp_after: number;
  cp_loss: number;
  best_san: string | null;
  pv_san: string[];
  fen_before: string | null;
  motif: string | null;
  motif_label: string;
}

const MOTIF_COLOR: Record<string, string> = {
  allowed_mate: "#f43f5e",
  material_loss: "#fb923c",
  winning_to_lost: "#f5a524",
  winning_advantage_thrown: "#facc15",
  positional_blunder: "#a18bff",
};

export function BlunderCard({ blunder, size = 240 }: { blunder: BlunderRow; size?: number }) {
  const fen = blunder.fen_before || "";
  const played = fen && blunder.san ? squaresOfSan(fen, blunder.san) : null;
  const orientation = blunder.my_color || turnFromFen(fen);

  const highlights = [
    ...(played ? [{ square: played.from, color: "#f43f5e66" }, { square: played.to, color: "#f43f5e" }] : []),
  ];
  const arrows = [
    ...(played ? [{ from: played.from, to: played.to, color: "#f43f5e" }] : []),
  ];

  return (
    <div className="surface p-4 flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="label-eyebrow text-[10px]">
            {blunder.date} - {blunder.my_color}
          </div>
          <div className="text-sm text-[color:var(--color-text)] truncate mt-1 font-medium">
            vs <span className="font-semibold tabular-nums">{blunder.opp_rating ?? "?"}</span>
          </div>
          {blunder.opening && (
            <div className="text-xs text-[color:var(--color-text-soft)] truncate mt-0.5">{blunder.opening}</div>
          )}
        </div>
        {blunder.motif && (
          <span
            className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-md whitespace-nowrap"
            style={{
              background: `${MOTIF_COLOR[blunder.motif] || "#a18bff"}22`,
              color: MOTIF_COLOR[blunder.motif] || "#a18bff",
            }}
          >
            {blunder.motif_label || blunder.motif}
          </span>
        )}
      </div>

      <div className="flex justify-center">
        <BoardView fen={fen} size={size} orientation={orientation} highlights={highlights} arrows={arrows} />
      </div>

      <div className="mt-4 text-sm space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="label-eyebrow text-[10px]">m.{blunder.move_number}</span>
          <span className="text-rose-300 font-mono font-semibold">{blunder.san}</span>
          <span className="text-xs text-[color:var(--color-muted)] font-mono">
            {cpToPawns(blunder.cp_before)} -&gt; {cpToPawns(blunder.cp_after)}
          </span>
        </div>
        <div className="text-xs text-[color:var(--color-text-soft)]">
          Rigiocala per vedere la mossa corretta.
        </div>
        <div className="text-xs text-rose-300 font-mono">
          -{cpToPawns(blunder.cp_loss).replace("+", "")} ({cpToHuman(blunder.cp_loss)})
        </div>
      </div>

      <div className="mt-auto pt-3 flex items-center justify-between text-xs hairline mt-3">
        <span className="font-mono text-[color:var(--color-muted)] uppercase tracking-widest text-[10px]">
          {blunder.phase}
        </span>
        {blunder.url && (
          <a
            href={blunder.url}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--color-brand-soft)] hover:underline"
          >
            Apri partita
          </a>
        )}
      </div>
    </div>
  );
}
