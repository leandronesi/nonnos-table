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
import type { RatingPoint, Goal } from "../types";
import { NonnoExplain } from "./NonnoExplain";
import { tr } from "../i18n/lang";

/** Rating ufficiale con medie mobili storiche sulle ultime 5 e 20 partite. */
interface Props {
  ratingCurve: Record<string, RatingPoint[]>;
  goal: Goal;
  /** Total games in rating_curve for the active time_class — shown as "su N partite" */
  totalGames?: number;
}

const RESULT_COLOR: Record<string, string> = {
  win: "#34d399",
  loss: "#f43f5e",
  draw: "#94a3b8",
};

export function RatingCurveChart({ ratingCurve, goal }: Props) {
  const available = Object.keys(ratingCurve).filter((k) => ratingCurve[k].length > 0);
  const initial = available.includes(goal.time_class) ? goal.time_class : available[0] || "";
  const [tc, setTc] = useState(initial);
  const curveCount = (ratingCurve[tc] || []).length;

  const data = useMemo(() => {
    const pts = ratingCurve[tc] || [];
    return pts.map((p, i) => ({
      i,
      date: p.date,
      rating: p.rating,
      perf_5: p.perf_5,
      perf_20: p.perf_20,
      opp_rating: p.opp_rating,
      result: p.result,
    }));
  }, [ratingCurve, tc]);

  const last = data[data.length - 1];
  const showTarget = tc === goal.time_class;

  return (
    <div className="surface surface-padded">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="label-eyebrow" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {tr("Media rating · ultime 5 + 20", "Rating averages · last 5 + 20")}
            <NonnoExplain
              title={tr("La tua salita", "Your climb")}
              lines={[
                tr(
                  "La linea del rating mostra i valori ufficiali registrati partita per partita. Le altre due sono medie degli stessi valori sulle ultime 5 e 20 partite.",
                  "The rating line shows the official values recorded game by game. The other two are averages of those same values over the last 5 and 20 games.",
                ),
                tr(
                  "Le medie rendono piu' leggibile lo storico, ma non sono un performance rating e non prevedono il rating futuro.",
                  "The averages make the history easier to read, but they are not performance ratings and do not predict future rating.",
                ),
              ]}
            />
          </div>
          <h3 className="section-title mt-1">{tr("Come si e' mosso il rating?", "How has the rating moved?")}</h3>
          <p className="section-sub mt-0.5" style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>
            {tr("Rating ufficiale e medie mobili", "Official rating and moving averages")}{curveCount > 0 ? ` · ${curveCount} ${tr("partite", "games")}` : ""}
          </p>
        </div>
        {available.length > 1 && (
          <div className="segment">
            {available.map((t) => (
              <button key={t} onClick={() => setTc(t)} className={`segment-item ${t === tc ? "active" : ""}`}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {last && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Pill label="Rating ora" value={last.rating != null ? Math.round(last.rating) : "—"} color="var(--color-brand-soft)" />
          <Pill label={tr("Media ultime 5", "Last-5 average")} value={last.perf_5 != null ? Math.round(last.perf_5) : "—"} color="#facc15" />
          <Pill label={tr("Media ultime 20", "Last-20 average")} value={last.perf_20 != null ? Math.round(last.perf_20) : "—"} color="#34d399" />
        </div>
      )}

      <div className="h-[360px]" role="img" aria-label={tr("Storico rating con medie mobili", "Rating history with moving averages")}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 80, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} minTickGap={48} />
            <YAxis tickLine={false} axisLine={false} domain={["dataMin - 60", "dataMax + 60"]} width={50} />
            <Tooltip
              content={<RichTooltip />}
              contentStyle={{ background: "transparent", border: "none", padding: 0, color: "var(--color-text)" }}
              itemStyle={{ color: "var(--color-text)" }}
              labelStyle={{ color: "var(--color-muted)" }}
              wrapperStyle={{ outline: "none" }}
            />
            <Legend
              wrapperStyle={{ paddingTop: 8 }}
              formatter={(v) =>
                v === "rating"
                  ? tr("Rating ufficiale", "Official rating")
                  : v === "perf_5"
                  ? tr("Media rating ultime 5", "Last-5 rating average")
                  : tr("Media rating ultime 20", "Last-20 rating average")
              }
            />
            {showTarget && (
              <ReferenceLine
                y={goal.target}
                stroke="#a18bff"
                strokeDasharray="4 4"
                label={{ value: `Target ${goal.target}`, position: "right", fill: "#a18bff", fontSize: 11 }}
              />
            )}
            <Line type="monotone" dataKey="perf_5" name="perf_5" stroke="#facc15" strokeWidth={1.5} dot={false} strokeDasharray="2 2" />
            <Line type="monotone" dataKey="perf_20" name="perf_20" stroke="#34d399" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="rating" name="rating" stroke="var(--color-brand-soft)" strokeWidth={2.5} dot={false} />
            <Customized component={(props: any) => <LastPointLabels {...props} data={data} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface TooltipPoint {
  payload: { date: string | null; rating: number | null; perf_5: number | null; perf_20: number | null; opp_rating: number | null; result: string | null };
}

function RichTooltip({ active, payload }: { active?: boolean; payload?: TooltipPoint[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface-2)] px-3 py-2 min-w-[200px]">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--color-muted)] mb-1.5">
        {p.date}
      </div>
      <Row label="Rating ufficiale" value={p.rating} color="var(--color-brand-soft)" />
      <Row label={tr("Media rating ultime 5", "Last-5 rating average")} value={p.perf_5} color="#facc15" />
      <Row label={tr("Media rating ultime 20", "Last-20 rating average")} value={p.perf_20} color="#34d399" />
      <div className="my-1.5 h-px bg-[color:var(--color-line)]" />
      <Row label="Avversario" value={p.opp_rating ?? "—"} />
      {p.result && (
        <div className="flex items-center justify-between text-sm mt-1">
          <span className="text-[color:var(--color-muted)]">Risultato</span>
          <span
            className="px-1.5 py-0.5 rounded text-xs font-bold"
            style={{
              background: `${RESULT_COLOR[p.result] || "#94a3b8"}22`,
              color: RESULT_COLOR[p.result] || "#94a3b8",
              border: `1px solid ${RESULT_COLOR[p.result] || "#94a3b8"}55`,
            }}
          >
            {p.result === "win" ? "V" : p.result === "loss" ? "P" : "="}
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: number | string | null; color?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[color:var(--color-muted)] flex items-center gap-1.5">
        {color && <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className="text-[color:var(--color-text)] tabular-nums font-medium">{value ?? "—"}</span>
    </div>
  );
}

function Pill({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] bg-white/[0.02]">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="label-eyebrow text-[10px]">{label}</span>
      <span className="font-mono font-semibold tabular-nums text-sm" style={{ color }}>{value}</span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LastPointLabels({ data, xAxisMap, yAxisMap }: any) {
  if (!data || data.length === 0 || !xAxisMap || !yAxisMap) return null;
  const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap[Object.keys(yAxisMap)[0]];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const last = data[data.length - 1];
  const x = xAxis.scale(last.date);
  if (x == null) return null;
  const items: Array<{ y: number; v: number | null; color: string }> = [
    { y: last.rating != null ? yAxis.scale(last.rating) : null, v: last.rating, color: "var(--color-brand-soft)" },
    { y: last.perf_5 != null ? yAxis.scale(last.perf_5) : null, v: last.perf_5, color: "#facc15" },
    { y: last.perf_20 != null ? yAxis.scale(last.perf_20) : null, v: last.perf_20, color: "#34d399" },
  ].filter((i) => i.y != null && i.v != null) as Array<{ y: number; v: number; color: string }>;
  return (
    <g>
      {items.map((it, idx) => (
        <g key={idx}>
          <circle cx={x} cy={it.y} r={4.5} fill={it.color} stroke="#0b0d18" strokeWidth={2} />
          <g transform={`translate(${x + 10},${it.y})`}>
            <rect x={0} y={-10} width={50} height={20} rx={4} fill={it.color} opacity={0.18} />
            <text x={6} y={4} fontSize={11} fill={it.color} fontWeight={700}>{Math.round(it.v as number)}</text>
          </g>
        </g>
      ))}
    </g>
  );
}
