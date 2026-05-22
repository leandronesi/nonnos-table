import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeManagement, Tilt } from "../types";

export function TimeManagementChart({
  time_management,
  tilt,
}: {
  time_management: TimeManagement;
  tilt: Tilt;
}) {
  const data = time_management.clock_vs_accuracy;
  const colors: Record<string, string> = {
    under_10s: "#f43f5e",
    "10_30s": "#fb923c",
    "30_60s": "#f5a524",
    "60_120s": "#facc15",
    over_120s: "#34d399",
  };

  return (
    <div className="surface surface-padded">
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 30, right: 20, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bucket" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
            <YAxis yAxisId="left" tickLine={false} axisLine={false} width={50} />
            <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={40} />
            <Tooltip
              formatter={(v: number, name: string) => [
                v,
                name === "avg_cp_loss" ? "ACPL" : name === "blunders" ? "Blunder" : name,
              ]}
              labelStyle={{ color: "var(--color-muted)" }}
            />
            <Bar yAxisId="right" dataKey="blunders" name="blunders" radius={[8, 8, 0, 0]} opacity={0.55}>
              {data.map((d) => (
                <Cell key={d.key} fill={colors[d.key] || "var(--color-blunder)"} />
              ))}
            </Bar>
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="avg_cp_loss"
              name="avg_cp_loss"
              stroke="var(--color-brand-soft)"
              strokeWidth={2.5}
              dot={{ r: 5, fill: "var(--color-brand-soft)", stroke: "#0a0c18", strokeWidth: 2 }}
            >
              <LabelList
                dataKey="avg_cp_loss"
                position="top"
                fill="var(--color-text)"
                fontSize={11}
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
        <StatCard
          label="Mosse istantanee in critica"
          sub="< 2 secondi su posizione critica"
          value={time_management.instant_moves_in_critical.n}
          danger={time_management.instant_moves_in_critical.avg_cp_loss > 100}
          metric={`ACPL ${time_management.instant_moves_in_critical.avg_cp_loss}`}
          extra={`${time_management.instant_moves_in_critical.blunders} blunder`}
        />
        <StatCard
          label="Mosse in zeitnot"
          sub="< 30s rimasti sull'orologio"
          value={time_management.zeitnot.n}
          danger={time_management.zeitnot.avg_cp_loss > 100}
          metric={`ACPL ${time_management.zeitnot.avg_cp_loss}`}
          extra={`${time_management.zeitnot.blunders} blunder`}
        />
        <StatCard
          label="Tilt factor"
          sub="quanto peggiori dopo un tuo blunder"
          value={`${tilt.tilt_factor}×`}
          danger={tilt.tilt_factor > 1.3}
          metric={`ACPL ${tilt.after_blunder_avg_cp_loss} · baseline ${tilt.baseline_avg_cp_loss}`}
          extra=""
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  sub,
  value,
  metric,
  extra,
  danger,
}: {
  label: string;
  sub: string;
  value: string | number;
  metric: string;
  extra: string;
  danger?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value tabular-nums ${danger ? "text-rose-300" : ""}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
      <div
        className="text-[11px] font-mono mt-2 pt-2 border-t border-[color:var(--color-line)] text-[color:var(--color-text-soft)] flex items-baseline justify-between"
      >
        <span>{metric}</span>
        {extra && <span className="text-[color:var(--color-muted)]">{extra}</span>}
      </div>
    </div>
  );
}
