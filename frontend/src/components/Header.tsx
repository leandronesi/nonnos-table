import type { Kpi } from "../types";

interface Props {
  username: string;
  kpi: Kpi;
  generatedAt: number;
}

export function Header({ username, kpi, generatedAt }: Props) {
  const date = new Date(generatedAt * 1000);
  const fmt = date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const ratings = Object.entries(kpi.rating_by_time_class);

  return (
    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-[color:var(--color-brand-soft)] font-semibold mb-1">
          Chess Coach
        </div>
        <h1 className="text-4xl lg:text-5xl font-[var(--font-display)] font-semibold tracking-tight">
          {username}
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Pattern ricorrenti delle tue debolezze · {kpi.games_analyzed} partite analizzate · ultimo aggiornamento{" "}
          {fmt}
        </p>
      </div>

      {ratings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ratings.map(([tc, r]) => (
            <div
              key={tc}
              className="card !py-2 !px-4 flex flex-col items-start min-w-[110px]"
            >
              <span className="text-[10px] uppercase tracking-widest text-slate-500">{tc}</span>
              <span className="text-xl font-semibold tabular-nums">{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
