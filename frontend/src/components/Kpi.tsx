import type { Kpi, ColorAgg, PerformanceAgg } from "../types";

function TrendArrow({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="trend-flat">—</span>;
  if (delta < -0.5) return <span className="trend-down">▼ {Math.abs(delta).toFixed(1)}</span>;
  if (delta > 0.5) return <span className="trend-up">▲ {delta.toFixed(1)}</span>;
  return <span className="trend-flat">≈ {delta.toFixed(1)}</span>;
}

interface Props {
  kpi: Kpi;
  byColor: Record<"white" | "black", ColorAgg>;
  performance: PerformanceAgg;
}

export function KpiRow({ kpi, byColor, performance }: Props) {
  const totalGames = byColor.white.games + byColor.black.games;
  const totalWins = byColor.white.wins + byColor.black.wins;
  const winRate = totalGames ? (totalWins / totalGames) * 100 : 0;
  const blunderPct = kpi.blunder_rate * 100;

  // Top time class per esposizione: quello con più partite
  const tcs = Object.entries(performance.by_time_class).sort((a, b) => b[1].games - a[1].games);
  const topTc = tcs[0];
  const topPerf = topTc?.[1];
  const perfGap =
    topPerf && topPerf.last_20 != null && topPerf.current_rating != null
      ? topPerf.last_20 - topPerf.current_rating
      : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mt-2">
      <div className="card">
        <div className="card-title">ACPL ultime 30</div>
        <div className="kpi-value mt-1 tabular-nums">{kpi.acpl_recent.toFixed(1)}</div>
        <div className="kpi-sub mt-1">
          vs precedenti 30: <TrendArrow delta={kpi.acpl_delta} /> (era {kpi.acpl_previous.toFixed(1)})
        </div>
      </div>

      <div className="card">
        <div className="card-title">Win rate</div>
        <div className="kpi-value mt-1 tabular-nums">{winRate.toFixed(1)}%</div>
        <div className="kpi-sub mt-1">
          {totalWins}V / {byColor.white.losses + byColor.black.losses}P /{" "}
          {byColor.white.draws + byColor.black.draws}D
        </div>
      </div>

      <div className="card">
        <div className="card-title">% mosse blunder</div>
        <div className="kpi-value mt-1 tabular-nums">{blunderPct.toFixed(2)}%</div>
        <div className="kpi-sub mt-1">{kpi.total_blunders} blunder · {kpi.games_analyzed} partite</div>
      </div>

      <div className="card">
        <div className="card-title">
          Elo atteso {topTc ? `(${topTc[0]} · ultime 20)` : ""}
        </div>
        <div className="kpi-value mt-1 tabular-nums">
          {topPerf?.last_20 ?? "—"}
        </div>
        <div className="kpi-sub mt-1">
          rating {topPerf?.current_rating ?? "—"}
          {perfGap !== null && (
            <>
              {" · "}
              <span className={perfGap >= 0 ? "text-green-300" : "text-red-300"}>
                gap {perfGap >= 0 ? "+" : ""}
                {perfGap}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
