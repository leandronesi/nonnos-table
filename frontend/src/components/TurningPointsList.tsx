import type { PositionRow } from "../types";
import { BlunderCard } from "./BlunderCard";
import type { BlunderRow } from "./BlunderCard";

// Adattatore: PositionRow → BlunderRow (la BlunderCard è già scritta per la v1, la riusiamo).
function toBlunder(p: PositionRow): BlunderRow {
  return {
    game_id: p.game_id,
    url: p.url,
    date: p.date,
    end_time_epoch: 0,
    time_class: null,
    my_color: p.my_color,
    my_rating: null,
    opp_rating: p.opp_rating,
    result: p.result,
    eco: p.eco,
    opening: p.opening,
    ply: p.ply,
    move_number: p.move_number,
    san: p.san,
    phase: p.phase,
    cp_before: p.cp_before,
    cp_after: p.cp_after,
    cp_loss: p.cp_loss,
    best_san: p.best_san_sf,
    pv_san: p.pv_san_sf ? p.pv_san_sf.split(" ") : [],
    fen_before: p.fen_before,
    motif: p.motif,
    motif_label: p.motif_label_it || "",
  };
}

interface Props {
  turning_points: PositionRow[];
  onPlay?: (p: PositionRow) => void;
}

export function TurningPointsList({ turning_points, onPlay }: Props) {
  if (!turning_points || turning_points.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {turning_points.map((tp) => (
        <div key={`${tp.game_id}-${tp.ply}`} className="flex flex-col">
          <BlunderCard blunder={toBlunder(tp)} size={240} />
          {onPlay && (
            <button
              onClick={() => onPlay(tp)}
              className="btn btn-primary text-xs mt-2 w-full justify-center"
            >
              ▶ Continua qui contro Stockfish
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
