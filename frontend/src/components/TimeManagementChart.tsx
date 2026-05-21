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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6 pt-6 hairline">
        <MetricRow
          label="Mosse istantanee"
          sub="< 2 secondi, in posizione critica"
          value={time_management.instant_moves_in_critical.n}
          danger={time_management.instant_moves_in_critical.avg_cp_loss > 100}
          detail={`ACPL ${time_management.instant_moves_in_critical.avg_cp_loss} · ${time_management.instant_moves_in_critical.blunders} blunder`}
        />
        <MetricRow
          label="In zeitnot"
          sub="< 30 secondi rimasti"
          value={time_management.zeitnot.n}
          danger={time_management.zeitnot.avg_cp_loss > 100}
          detail={`ACPL ${time_management.zeitnot.avg_cp_loss} · ${time_management.zeitnot.blunders} blunder`}
        />
        <MetricRow
          label="Tilt factor"
          sub="ACPL post-blunder ÷ baseline"
          value={`${tilt.tilt_factor}×`}
          danger={tilt.tilt_factor > 1.3}
          detail={`${tilt.after_blunder_avg_cp_loss} vs ${tilt.baseline_avg_cp_loss}`}
        />
      </div>
    </div>
  );
}

function MetricRow({
  label,
  sub,
  value,
  detail,
  danger,
}: {
  label: string;
  sub: string;
  value: string | number;
  detail: string;
  danger?: boolean;
}) {
  return (
    <div>
      <div className="label-eyebrow">{label}</div>
      <div className="text-xs text-[color:var(--color-muted)] mt-1">{sub}</div>
      <div className={`display-small tabular-nums mt-3 ${danger ? "text-rose-300" : "text-[color:var(--color-text)]"}`}>
        {value}
      </div>
      <div className="text-xs font-mono text-[color:var(--color-text-soft)] mt-1">{detail}</div>
    </div>
  );
}
