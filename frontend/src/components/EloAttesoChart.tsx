import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Customized,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RatingTrendPoint, Goal } from "../types";
import { Help } from "./Help";
import { GLOSS } from "../glossary";

interface Props {
  ratingTrend: Record<string, RatingTrendPoint[]>;
  goal: Goal;
}

const RESULT_LABEL: Record<string, string> = { win: "V", loss: "P", draw: "=" };
const RESULT_COLOR: Record<string, string> = {
  win: "#22c55e",
  loss: "#ef4444",
  draw: "#94a3b8",
};

export function EloAttesoChart({ ratingTrend, goal }: Props) {
  const available = Object.keys(ratingTrend).filter((k) => ratingTrend[k].length > 0);
  const initial = available.includes(goal.time_class) ? goal.time_class : available[0] || "";
  const [tc, setTc] = useState(initial);

  const data = useMemo(() => {
    const pts = ratingTrend[tc] || [];
    return pts.map((p, i) => ({
      i,
      date: p.date,
      rating: p.rating,
      performance: p.performance_rolling,
      result: p.result,
      opp_rating: p.opp_rating,
      game_id: p.game_id,
    }));
  }, [ratingTrend, tc]);

  const last = data[data.length - 1];
  const showTarget = tc === goal.time_class;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="card-title flex items-center gap-2">
            Elo atteso · rating ufficiale vs performance
            <Help text={GLOSS.performance_rating} />
          </div>
          <p className="text-slate-400 text-sm mt-1 max-w-2xl">
            Viola = rating ufficiale Chess.com. Giallo = performance rating mobile
            (finestra 20 partite) — dove "dovresti" essere se il sistema non avesse
            inerzia. Quando giallo sta sopra viola, il rating ti sta inseguendo.
          </p>
        </div>
        <div className="inline-flex bg-slate-900 border border-[color:var(--color-line)] rounded-lg p-0.5">
          {available.map((t) => (
            <button
              key={t}
              onClick={() => setTc(t)}
              className={
                "px-3 py-1 rounded-md text-xs transition " +
                (t === tc
                  ? "bg-[color:var(--color-brand)] text-white"
                  : "text-slate-300 hover:text-white")
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {last && (
        <div className="flex flex-wrap items-baseline gap-3 mt-3">
          <Pill
            label="Rating ora"
            value={last.rating ?? "—"}
            dotColor="var(--color-brand-soft)"
          />
          <Pill
            label="Performance ultime 20"
            value={last.performance ?? "—"}
            dotColor="var(--color-warn)"
          />
          {last.rating != null && last.performance != null && (
            <Pill
              label="Gap"
              value={`${last.performance - last.rating >= 0 ? "+" : ""}${
                last.performance - last.rating
              }`}
              dotColor={
                last.performance - last.rating >= 0
                  ? "var(--color-ok)"
                  : "var(--color-danger)"
              }
              good={last.performance - last.rating >= 0}
              bad={last.performance - last.rating < 0}
            />
          )}
          {showTarget && (
            <Pill
              label={`Target ${goal.deadline}`}
              value={goal.target}
              dotColor="var(--color-ok)"
            />
          )}
        </div>
      )}

      <div className="h-[340px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 90, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={{ stroke: "var(--color-line)" }}
              minTickGap={40}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              domain={["dataMin - 50", "dataMax + 50"]}
              width={50}
            />
            <Tooltip content={<RichTooltip />} />
            <Legend
              wrapperStyle={{ paddingTop: 8 }}
              formatter={(v) =>
                v === "rating" ? "Rating ufficiale" : "Performance rolling 20"
              }
            />
            {showTarget && (
              <ReferenceLine
                y={goal.target}
                stroke="var(--color-ok)"
                strokeDasharray="4 4"
                label={{
                  value: `Target ${goal.target}`,
                  position: "right",
                  fill: "var(--color-ok)",
                  fontSize: 11,
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="rating"
              name="rating"
              stroke="var(--color-brand-soft)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: "var(--color-brand-soft)" }}
            />
            <Line
              type="monotone"
              dataKey="performance"
              name="performance"
              stroke="var(--color-warn)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 5, fill: "var(--color-warn)" }}
            />
            <Customized component={(props: any) => <LastPointLabel {...props} data={data} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface TooltipPayloadItem {
  payload: {
    date: string | null;
    rating: number | null;
    performance: number | null;
    opp_rating: number | null;
    result: string | null;
  };
}

function RichTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-slate-950/95 px-3 py-2.5 shadow-2xl backdrop-blur min-w-[200px]">
      <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1.5">
        {p.date}
      </div>
      <Row label="Rating ufficiale" value={p.rating} color="var(--color-brand-soft)" />
      <Row label="Performance (20)" value={p.performance} color="var(--color-warn)" />
      <div className="my-1.5 h-px bg-[color:var(--color-line)]" />
      <Row label="Avversario" value={p.opp_rating ?? "—"} />
      {p.result && (
        <div className="flex items-center justify-between text-sm mt-1">
          <span className="text-slate-400">Risultato</span>
          <span
            className="px-1.5 py-0.5 rounded text-xs font-bold tabular-nums"
            style={{
              background: `${RESULT_COLOR[p.result] || "#94a3b8"}22`,
              color: RESULT_COLOR[p.result] || "#94a3b8",
              border: `1px solid ${RESULT_COLOR[p.result] || "#94a3b8"}55`,
            }}
          >
            {RESULT_LABEL[p.result] || p.result}
          </span>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string | null;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-400 flex items-center gap-1.5">
        {color && (
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: color }}
          />
        )}
        {label}
      </span>
      <span className="text-slate-100 tabular-nums font-medium">{value ?? "—"}</span>
    </div>
  );
}

function Pill({
  label,
  value,
  dotColor,
  good,
  bad,
}: {
  label: string;
  value: string | number;
  dotColor: string;
  good?: boolean;
  bad?: boolean;
}) {
  const valColor = good ? "text-green-300" : bad ? "text-red-300" : "text-slate-100";
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] bg-slate-900/60">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: dotColor }}
      />
      <span className="text-[11px] uppercase tracking-widest text-slate-500">
        {label}
      </span>
      <span className={`text-base font-semibold tabular-nums ${valColor}`}>{value}</span>
    </div>
  );
}

// Etichetta fissa sull'ultimo punto. Le scale degli assi le riceviamo come prop
// quando <Customized> è dentro un LineChart Recharts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LastPointLabel({ data, xAxisMap, yAxisMap }: any) {
  if (!data || data.length === 0 || !xAxisMap || !yAxisMap) return null;
  const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap[Object.keys(yAxisMap)[0]];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const last = data[data.length - 1];
  const x = xAxis.scale(last.date);
  const yRating = last.rating != null ? yAxis.scale(last.rating) : null;
  const yPerf = last.performance != null ? yAxis.scale(last.performance) : null;
  if (x == null) return null;

  return (
    <g>
      {yRating != null && (
        <>
          <circle
            cx={x}
            cy={yRating}
            r={5}
            fill="var(--color-brand-soft)"
            stroke="#0b0d18"
            strokeWidth={2}
          />
          <g transform={`translate(${x + 10},${yRating})`}>
            <rect
              x={0}
              y={-10}
              width={50}
              height={20}
              rx={4}
              fill="var(--color-brand-soft)"
              opacity={0.2}
            />
            <text x={6} y={4} fontSize={11} fill="var(--color-brand-soft)" fontWeight={700}>
              {last.rating}
            </text>
          </g>
        </>
      )}
      {yPerf != null && (
        <>
          <circle
            cx={x}
            cy={yPerf}
            r={5}
            fill="var(--color-warn)"
            stroke="#0b0d18"
            strokeWidth={2}
          />
          <g transform={`translate(${x + 10},${yPerf})`}>
            <rect
              x={0}
              y={-10}
              width={50}
              height={20}
              rx={4}
              fill="var(--color-warn)"
              opacity={0.2}
            />
            <text x={6} y={4} fontSize={11} fill="var(--color-warn)" fontWeight={700}>
              {last.performance}
            </text>
          </g>
        </>
      )}
    </g>
  );
}
