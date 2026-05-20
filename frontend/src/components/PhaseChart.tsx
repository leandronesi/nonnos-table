import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Phase, PhaseStats } from "../types";

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

export function PhaseChart({ byPhase }: { byPhase: Record<Phase, PhaseStats> }) {
  const data = (["opening", "middlegame", "endgame"] as Phase[]).map((ph) => ({
    phase: PHASE_LABEL[ph],
    phaseKey: ph,
    inaccuracy: byPhase[ph].inaccuracy,
    mistake: byPhase[ph].mistake,
    blunder: byPhase[ph].blunder,
    acpl: byPhase[ph].acpl ?? 0,
  }));

  return (
    <div className="card h-full">
      <div className="card-title">Dove sbaglio · per fase</div>
      <p className="text-slate-400 text-sm mt-1">Il grafico chiave dei pattern.</p>

      <div className="h-[280px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="phase" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Legend />
            <Bar dataKey="inaccuracy" name="Imprecisioni" stackId="a" fill="var(--color-inaccuracy)" radius={[0,0,0,0]} />
            <Bar dataKey="mistake" name="Errori" stackId="a" fill="var(--color-mistake)" />
            <Bar dataKey="blunder" name="Blunder" stackId="a" fill="var(--color-blunder)" radius={[6,6,0,0]}>
              {data.map((d) => (
                <Cell key={d.phaseKey} fill={PHASE_COLOR[d.phaseKey]} opacity={0} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        {data.map((d) => (
          <div key={d.phaseKey} className="border border-[color:var(--color-line)] rounded-lg py-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">{d.phase}</div>
            <div className="text-lg font-semibold tabular-nums" style={{ color: PHASE_COLOR[d.phaseKey] }}>
              {d.acpl} <span className="text-xs text-slate-500">ACPL</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
