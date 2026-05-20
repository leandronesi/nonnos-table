import type { BlunderRow } from "../types";
import { BlunderCard } from "./BlunderCard";

interface Props {
  picks: BlunderRow[];
}

export function DailyReview({ picks }: Props) {
  if (!picks || picks.length === 0) {
    return (
      <div className="card mt-5">
        <div className="card-title">Review di oggi</div>
        <p className="text-slate-400 text-sm mt-2">
          Niente blunder recenti — bravo. Torna domani dopo aver giocato qualche partita.
        </p>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="card-title">Review di oggi · {today}</div>
          <p className="text-slate-400 text-sm mt-1">
            5 blunder da rivedere dalle tue ultime partite. Apri la scacchiera, cerca la mossa giusta da solo,
            poi confronta con quella suggerita. Cambia ogni giorno.
          </p>
        </div>
        <span className="text-xs text-slate-500">{picks.length} posizioni</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {picks.map((b) => (
          <BlunderCard key={`${b.game_id}-${b.ply}`} blunder={b} size={240} />
        ))}
      </div>
    </div>
  );
}
