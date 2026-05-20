import { useMemo, useState } from "react";
import {
  CartesianGrid,
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

interface Props {
  ratingTrend: Record<string, RatingTrendPoint[]>;
  goal: Goal;
}

export function EloAttesoChart({ ratingTrend, goal }: Props) {
  const available = Object.keys(ratingTrend);
  const initial =
    available.includes(goal.time_class) ? goal.time_class : available[0] || "";
  const [tc, setTc] = useState(initial);

  const data = useMemo(() => {
    const pts = ratingTrend[tc] || [];
    return pts.map((p, i) => ({
      i,
      date: p.date,
      rating: p.rating,
      performance: p.performance_rolling,
    }));
  }, [ratingTrend, tc]);

  const last = data[data.length - 1];
  const showTarget = tc === goal.time_class;

  return (
    <div className="card">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="card-title">Elo atteso · rating ufficiale vs performance</div>
          <p className="text-slate-400 text-sm mt-1">
            La linea viola è il rating ufficiale Chess.com. La gialla è il <b>performance rating</b>{" "}
            rolling delle ultime 20 partite — dove "dovresti" stare se il sistema fosse senza inerzia.
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

      <div className="h-[320px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 20, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} minTickGap={40} />
            <YAxis tickLine={false} axisLine={false} domain={["dataMin - 50", "dataMax + 50"]} width={50} />
            <Tooltip
              labelStyle={{ color: "var(--color-muted)" }}
              formatter={(v: number, name: string) => [v, name === "rating" ? "Rating ufficiale" : "Performance (rolling 20)"]}
            />
            <Legend />
            {showTarget && (
              <ReferenceLine
                y={goal.target}
                stroke="var(--color-ok)"
                strokeDasharray="4 4"
                label={{ value: `Target ${goal.target}`, position: "right", fill: "var(--color-ok)", fontSize: 11 }}
              />
            )}
            <Line
              type="monotone"
              dataKey="rating"
              name="Rating ufficiale"
              stroke="var(--color-brand-soft)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="performance"
              name="Performance rolling 20"
              stroke="var(--color-warn)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {last && (
        <div className="text-xs text-slate-400 mt-2">
          Ultimo: rating <b className="text-slate-200">{last.rating}</b> · performance{" "}
          <b className="text-slate-200">{last.performance ?? "—"}</b>
          {last.rating != null && last.performance != null && (
            <span className="ml-2">
              gap{" "}
              <b
                className={
                  last.performance - last.rating >= 0 ? "text-green-300" : "text-red-300"
                }
              >
                {last.performance - last.rating >= 0 ? "+" : ""}
                {last.performance - last.rating}
              </b>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
