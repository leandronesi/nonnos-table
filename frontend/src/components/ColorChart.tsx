import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ColorAgg } from "../types";

export function ColorChart({ byColor }: { byColor: Record<"white" | "black", ColorAgg> }) {
  const data = [
    {
      label: "Bianco",
      games: byColor.white.games,
      wins: byColor.white.wins,
      acpl: byColor.white.acpl,
      blunders: byColor.white.blunders,
      mistakes: byColor.white.mistakes,
      inaccuracies: byColor.white.inaccuracies,
      win_rate: byColor.white.win_rate,
    },
    {
      label: "Nero",
      games: byColor.black.games,
      wins: byColor.black.wins,
      acpl: byColor.black.acpl,
      blunders: byColor.black.blunders,
      mistakes: byColor.black.mistakes,
      inaccuracies: byColor.black.inaccuracies,
      win_rate: byColor.black.win_rate,
    },
  ];

  return (
    <div className="card">
      <div className="card-title">Bianco vs Nero</div>
      <p className="text-slate-400 text-sm mt-1">Confronto performance e tipi di errore.</p>

      <div className="grid grid-cols-2 gap-3 mt-3">
        {data.map((d) => (
          <div key={d.label} className="rounded-xl border border-[color:var(--color-line)] p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-sm text-slate-300">{d.label}</div>
              <div className="text-xs text-slate-500">{d.games} partite</div>
            </div>
            <div className="kpi-value mt-1">{Math.round(d.win_rate * 100)}%</div>
            <div className="kpi-sub">win rate · ACPL {d.acpl}</div>
          </div>
        ))}
      </div>

      <div className="h-[200px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Legend />
            <Bar dataKey="inaccuracies" name="Imprecisioni" stackId="a" fill="var(--color-inaccuracy)" />
            <Bar dataKey="mistakes" name="Errori" stackId="a" fill="var(--color-mistake)" />
            <Bar dataKey="blunders" name="Blunder" stackId="a" fill="var(--color-blunder)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
