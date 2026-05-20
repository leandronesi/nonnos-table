import type { Goal } from "../types";

interface Props {
  goal: Goal;
}

export function GoalTracker({ goal }: Props) {
  if (goal.no_data) return null;
  const current = goal.current_rating ?? 0;
  const target = goal.target;
  const start = goal.start_rating ?? current;
  const total = Math.max(target - start, 1);
  const progress = Math.max(0, Math.min(1, (current - start) / total));
  const pct = Math.round(progress * 100);

  const projection = goal.projection_at_deadline ?? current;
  const projOnBar = Math.max(0, Math.min(1, (projection - start) / total));
  const projPct = Math.round(projOnBar * 100);

  const onTrack = goal.on_track ?? false;

  return (
    <div className="card mt-5 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          background: onTrack
            ? "radial-gradient(600px 200px at 90% 30%, rgba(34,197,94,0.18), transparent 70%)"
            : "radial-gradient(600px 200px at 90% 30%, rgba(239,68,68,0.16), transparent 70%)",
        }}
      />
      <div className="relative flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <div className="card-title">
            Obiettivo · {target} {goal.time_class} entro {goal.deadline}
          </div>
          <div className="flex items-baseline gap-4 mt-1">
            <div className="kpi-value tabular-nums">{current}</div>
            <div className="text-sm text-slate-400">
              → <span className="text-slate-200 font-medium">{target}</span> ·{" "}
              <span className="text-slate-300">{goal.points_needed} pt</span> ·{" "}
              <span className="text-slate-300">{goal.days_left} giorni</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end">
          <span
            className={
              "text-xs font-semibold px-2.5 py-1 rounded-full " +
              (onTrack
                ? "bg-green-500/15 text-green-300 border border-green-500/30"
                : "bg-red-500/15 text-red-300 border border-red-500/30")
            }
          >
            {onTrack ? "ON TRACK" : "DIETRO"}
          </span>
          <div className="text-xs text-slate-400 mt-1">
            Proiezione: <span className="text-slate-200 font-medium">{projection}</span>
          </div>
        </div>
      </div>

      {/* progress bar */}
      <div className="relative mt-6">
        <div className="h-3 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-3"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--color-brand) 0%, var(--color-brand-soft) 100%)",
            }}
          />
        </div>
        {/* marker proiezione */}
        <div
          className="absolute -top-1 w-0.5 h-5"
          style={{
            left: `${projPct}%`,
            background: onTrack ? "var(--color-ok)" : "var(--color-danger)",
            transform: "translateX(-50%)",
          }}
          title={`Proiezione: ${projection}`}
        />
        {/* etichette agli estremi */}
        <div className="flex justify-between mt-1 text-[11px] text-slate-500 tabular-nums">
          <span>{start} (start)</span>
          <span>{target}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 text-sm">
        <Stat
          label="Ritmo finora"
          value={goal.rate_per_day_so_far != null ? `${goal.rate_per_day_so_far}/d` : "—"}
          sub={`+${goal.points_gained_since_start ?? 0} pt in ${goal.days_since_start} g`}
        />
        <Stat
          label="Ritmo richiesto"
          value={goal.rate_per_day_needed != null ? `${goal.rate_per_day_needed}/d` : "—"}
          sub={`per arrivare a ${target}`}
          danger={!onTrack}
        />
        <Stat
          label="Performance last 20"
          value={goal.performance_last_20 != null ? `${goal.performance_last_20}` : "—"}
          sub={
            goal.performance_vs_rating_gap != null
              ? `${goal.performance_vs_rating_gap >= 0 ? "+" : ""}${goal.performance_vs_rating_gap} vs rating`
              : ""
          }
          good={goal.performance_vs_rating_gap != null && goal.performance_vs_rating_gap > 0}
          danger={goal.performance_vs_rating_gap != null && goal.performance_vs_rating_gap < 0}
        />
        <Stat
          label="Completato"
          value={`${pct}%`}
          sub={`${current - start} di ${target - start} pt`}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  good,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  good?: boolean;
  danger?: boolean;
}) {
  const color = good ? "text-green-300" : danger ? "text-red-300" : "text-slate-100";
  return (
    <div className="border border-[color:var(--color-line)] rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
