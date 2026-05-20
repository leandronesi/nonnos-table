import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";
import type { MotifAgg } from "../types";

const MOTIF_COLOR: Record<string, string> = {
  allowed_mate: "#ef4444",
  material_loss: "#fb923c",
  winning_to_lost: "#f59e0b",
  winning_advantage_thrown: "#facc15",
  positional_blunder: "#a18bff",
};

export function TacticsMotifs({ motifs }: { motifs: MotifAgg[] }) {
  if (!motifs || motifs.length === 0) return null;
  const total = motifs.reduce((s, m) => s + m.count, 0);

  return (
    <div className="card">
      <div className="card-title">Motivi tattici · perché perdi materiale</div>
      <p className="text-slate-400 text-sm mt-1">
        Classificazione automatica dei blunder. Il motivo dominante è dove allenarsi prima.
      </p>

      <div className="h-[220px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={motifs}
            layout="vertical"
            margin={{ top: 8, right: 30, left: 80, bottom: 0 }}
          >
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="label_it"
              tickLine={false}
              axisLine={false}
              width={130}
            />
            <Tooltip
              formatter={(v: number) => [`${v} (${Math.round((v / total) * 100)}%)`, "Casi"]}
            />
            <Bar dataKey="count" radius={[0, 8, 8, 0]}>
              {motifs.map((m) => (
                <Cell key={m.motif} fill={MOTIF_COLOR[m.motif] || "#a18bff"} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                fill="var(--color-text)"
                fontSize={12}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="text-xs text-slate-500 mt-2">
        Totale blunder classificati: <span className="text-slate-300">{total}</span>
      </div>
    </div>
  );
}
