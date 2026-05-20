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
import { Help } from "./Help";
import { GLOSS } from "../glossary";

export function TrendChart({ data }: { data: MonthAgg[] }) {
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const acplDelta = last && prev ? last.acpl - prev.acpl : null;

  return (
    <div className="card h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="card-title flex items-center gap-2">
            Trend per mese · <Help label="ACPL" text={GLOSS.acpl} /> + blunder
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Più basso ACPL = più preciso. Le barre rosse sono i blunder per mese.
          </p>
        </div>
        {last && (
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">
              {last.month}
            </div>
            <div className="text-2xl font-semibold tabular-nums">{last.acpl.toFixed(1)}</div>
            <div className="text-xs text-slate-500">
              ACPL ·{" "}
              <span className="text-red-300">{last.blunders}</span> blunder
            </div>
            {acplDelta != null && (
              <div
                className={
                  "text-[11px] mt-1 " +
                  (acplDelta < -0.5
                    ? "text-green-300"
                    : acplDelta > 0.5
                    ? "text-red-300"
                    : "text-slate-500")
                }
              >
                {acplDelta < 0 ? "▼" : acplDelta > 0 ? "▲" : "≈"}{" "}
                {Math.abs(acplDelta).toFixed(1)} vs mese prec
              </div>
            )}
          </div>
        )}
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
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={{ stroke: "var(--color-line)" }}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              width={50}
              label={{
                value: "ACPL (precisione)",
                angle: -90,
                position: "insideLeft",
                offset: 16,
                fill: "var(--color-muted)",
                fontSize: 11,
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={40}
              label={{
                value: "blunder",
                angle: 90,
                position: "insideRight",
                offset: 12,
                fill: "var(--color-muted)",
                fontSize: 11,
              }}
            />
            <Tooltip content={<TrendTooltip />} />
            <Legend formatter={(v) => (v === "acpl" ? "ACPL (precisione mossa)" : "Blunder (errori gravi)")} />
            <Bar
              yAxisId="right"
              dataKey="blunders"
              name="blunders"
              fill="var(--color-blunder)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              opacity={0.55}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="acpl"
              name="acpl"
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

interface TooltipPoint {
  payload: {
    month: string;
    acpl: number;
    blunders: number;
    mistakes: number;
    inaccuracies: number;
    games: number;
    win_rate: number;
    wins: number;
    losses: number;
    draws: number;
  };
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: TooltipPoint[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-slate-950/95 px-3 py-2.5 shadow-2xl min-w-[200px]">
      <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1.5">
        {p.month}
      </div>
      <Row label="ACPL" value={p.acpl.toFixed(1)} color="var(--color-brand-soft)" />
      <Row label="Blunder" value={p.blunders} color="var(--color-blunder)" />
      <Row label="Errori" value={p.mistakes} color="var(--color-mistake)" />
      <Row label="Imprecisioni" value={p.inaccuracies} color="var(--color-inaccuracy)" />
      <div className="my-1.5 h-px bg-[color:var(--color-line)]" />
      <Row label="Partite" value={p.games} />
      <Row label="Win rate" value={`${Math.round(p.win_rate * 100)}%`} />
      <div className="text-xs text-slate-500 mt-1">
        {p.wins}V · {p.losses}P · {p.draws}D
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-400 flex items-center gap-1.5">
        {color && <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className="text-slate-100 tabular-nums font-medium">{value}</span>
    </div>
  );
}
