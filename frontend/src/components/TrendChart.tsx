import {
  Area,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
  Bar,
} from "recharts";
import type { MonthAgg } from "../types";

export function TrendChart({ data }: { data: MonthAgg[] }) {
  return (
    <div className="card h-full">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="card-title">Trend ACPL · per mese</div>
          <p className="text-slate-400 text-sm mt-1">Sto migliorando o peggiorando?</p>
        </div>
        <div className="text-xs text-slate-500">{data.length} mesi</div>
      </div>

      <div className="h-[280px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="acplGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.55} />
                <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              width={50}
              label={{ value: "ACPL", angle: -90, position: "insideLeft", offset: 16, fill: "var(--color-muted)", fontSize: 11 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip />
            <Legend />
            <Bar
              yAxisId="right"
              dataKey="blunders"
              name="Blunder"
              fill="var(--color-blunder)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              opacity={0.55}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="acpl"
              name="ACPL"
              stroke="var(--color-brand-soft)"
              strokeWidth={2.5}
              fill="url(#acplGrad)"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
