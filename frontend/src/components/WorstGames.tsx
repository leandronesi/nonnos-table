import type { WorstGameRow } from "../types";

interface Props {
  rows: WorstGameRow[];
  onOpen: (gameId: string) => void;
}

export function WorstGames({ rows, onOpen }: Props) {
  return (
    <div className="card mt-5">
      <div className="card-title">Le tue peggiori partite</div>
      <p className="text-slate-400 text-sm mt-1">
        Combinazione di ACPL alto + blunder. Clicca una riga per il drill-down con scacchiera.
      </p>

      <div className="overflow-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <Th>Data</Th>
              <Th>Cad</Th>
              <Th>Col</Th>
              <Th>Avv</Th>
              <Th>Apertura</Th>
              <Th align="right">Mosse</Th>
              <Th align="right">ACPL</Th>
              <Th align="right">Blund</Th>
              <Th align="right">Worst loss</Th>
              <Th align="right">Score</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr
                key={g.id}
                onClick={() => onOpen(g.id)}
                className="border-t border-[color:var(--color-line)] cursor-pointer hover:bg-slate-800/40 transition"
              >
                <td className="py-2 pr-3 text-slate-300">{g.date}</td>
                <td className="py-2 pr-3 text-slate-300">{g.time_class}</td>
                <td className="py-2 pr-3">
                  <ColorDot color={g.my_color} />
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {g.opp_rating ?? "—"}{" "}
                  <ResultBadge result={g.result} />
                </td>
                <td className="py-2 pr-3 text-slate-300 max-w-[260px] truncate">{g.opening || "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.num_moves}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.acpl}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-red-300">{g.counts.blunder}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.worst_move_loss}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-semibold">{g.ugliness}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-6 text-center text-slate-500">
                  Niente da mostrare con i filtri attuali.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`py-2 pr-3 text-xs uppercase tracking-wider ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function ColorDot({ color }: { color: string | null }) {
  if (color === "white")
    return (
      <span className="inline-block w-3 h-3 rounded-full" style={{ background: "#e6e9f5" }} />
    );
  if (color === "black")
    return (
      <span
        className="inline-block w-3 h-3 rounded-full"
        style={{ background: "#1f2740", border: "1px solid #6b7393" }}
      />
    );
  return <span className="text-slate-500">—</span>;
}

function ResultBadge({ result }: { result: string | null }) {
  const map: Record<string, { c: string; l: string }> = {
    win: { c: "text-green-300", l: "V" },
    loss: { c: "text-red-300", l: "P" },
    draw: { c: "text-slate-400", l: "=" },
  };
  const r = map[result || ""] || { c: "text-slate-500", l: "?" };
  return <span className={`ml-2 text-xs font-semibold ${r.c}`}>{r.l}</span>;
}
