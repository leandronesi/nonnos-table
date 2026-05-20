import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, LabelList } from "recharts";
import type { TimeClassAgg } from "../types";

const TC_COLOR: Record<string, string> = {
  bullet: "#ef4444",
  blitz: "#f59e0b",
  rapid: "#22c55e",
  daily: "#60a5fa",
  unknown: "#6b7393",
};

export function TimeClassChart({ data }: { data: TimeClassAgg[] }) {
  return (
    <div className="card">
      <div className="card-title">Per cadenza · cosa stai giocando</div>
      <p className="text-slate-400 text-sm mt-1">ACPL e blunder per time class.</p>

      <div className="h-[260px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time_class" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar dataKey="acpl" name="ACPL" radius={[6, 6, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.time_class} fill={TC_COLOR[d.time_class] || TC_COLOR.unknown} />
              ))}
              <LabelList dataKey="games" position="top" formatter={(v: number) => `${v}g`} fill="var(--color-muted)" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
