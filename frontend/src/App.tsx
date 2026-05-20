import { useEffect, useState } from "react";
import type { Metrics } from "./types";
import { loadMetrics } from "./data";
import { useFilters, useDerived } from "./filters";

import { Header } from "./components/Header";
import { KpiRow } from "./components/Kpi";
import { GoalTracker } from "./components/GoalTracker";
import { EloAttesoChart } from "./components/EloAttesoChart";
import { DailyReview } from "./components/DailyReview";
import { TrendChart } from "./components/TrendChart";
import { PhaseChart } from "./components/PhaseChart";
import { OpeningsTable } from "./components/OpeningsTable";
import { ColorChart } from "./components/ColorChart";
import { HeatmapChart } from "./components/HeatmapChart";
import { TimeClassChart } from "./components/TimeClassChart";
import { FiltersBar } from "./components/FiltersBar";
import { InsightsCard } from "./components/InsightsCard";
import { TacticsMotifs } from "./components/TacticsMotifs";
import { WorstGames } from "./components/WorstGames";
import { BlunderReview } from "./components/BlunderReview";
import { GameDetail } from "./components/GameDetail";

export function App() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const { f, update, reset } = useFilters();
  const d = useDerived(metrics, f);

  useEffect(() => {
    loadMetrics()
      .then(setMetrics)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="card max-w-xl">
          <div className="card-title mb-2">Dati non disponibili</div>
          <p className="text-slate-300 leading-relaxed">{error}</p>
          <p className="kpi-sub mt-3">
            Genera i dati con:{" "}
            <code className="bg-slate-900 px-2 py-1 rounded">
              python backend/ingest.py && python backend/analyze.py && python backend/metrics.py
            </code>
          </p>
        </div>
      </div>
    );
  }

  if (!metrics || !d) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Carico le metriche…
      </div>
    );
  }

  const empty = d.games.length === 0;
  const agg = metrics.aggregates;

  return (
    <div className="min-h-screen max-w-[1400px] mx-auto px-6 py-8">
      <Header username={metrics.username} kpi={d.kpi} generatedAt={metrics.generated_at_epoch} />

      <GoalTracker goal={agg.goal} />

      <FiltersBar
        metrics={metrics}
        filters={f}
        onUpdate={update}
        onReset={reset}
        filteredCount={d.games.length}
      />

      {empty ? (
        <div className="card mt-6 text-slate-300">
          Nessuna partita corrisponde ai filtri selezionati.
        </div>
      ) : (
        <>
          <KpiRow kpi={d.kpi} byColor={d.byColor} performance={agg.performance} />

          <DailyReview picks={metrics.top.daily_picks} />

          <InsightsCard insights={metrics.insights} />

          <div className="mt-5">
            <EloAttesoChart ratingTrend={agg.rating_trend} goal={agg.goal} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
            <div className="lg:col-span-2">
              <TrendChart data={d.byMonth} />
            </div>
            <PhaseChart byPhase={d.byPhase} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
            <ColorChart byColor={d.byColor} />
            <TimeClassChart data={d.byTimeClass} />
            <TacticsMotifs motifs={agg.motifs} />
          </div>

          <div className="mt-5">
            <HeatmapChart data={d.moveHeatmap} />
          </div>

          <WorstGames rows={metrics.top.worst_games} onOpen={setOpenGameId} />

          <BlunderReview blunders={metrics.top.blunders} />

          <div className="mt-5">
            <OpeningsTable rows={d.byOpening} />
          </div>

          <footer className="text-center text-xs text-slate-500 mt-10 mb-4">
            Generato da Chess Coach · Stockfish 17 · {d.games.length} partite filtrate su{" "}
            {metrics.games.length} totali · target {agg.goal.target} blitz entro {agg.goal.deadline}.
          </footer>
        </>
      )}

      {openGameId && <GameDetail gameId={openGameId} onClose={() => setOpenGameId(null)} />}
    </div>
  );
}
