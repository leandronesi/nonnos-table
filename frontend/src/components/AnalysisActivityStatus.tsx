import { useEffect, useState } from "react";
import type { OrchestratorProgress } from "../pipeline/orchestrator";
import { tr } from "../i18n/lang";

export function AnalysisActivityStatus({ progress }: { progress: OrchestratorProgress | null | undefined }) {
  const [lastChange, setLastChange] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const activity = progress?.activity;
  const [baseline, setBaseline] = useState({ at: Date.now(), completed: activity?.completed ?? 0 });
  useEffect(() => { setBaseline({ at: Date.now(), completed: activity?.completed ?? 0 }); }, [activity?.stage, activity?.total]);
  useEffect(() => { setLastChange(Date.now()); }, [progress?.phase, progress?.gamesAnalyzed, progress?.gamesDone, progress?.monthsDone, activity?.stage, activity?.completed]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const labels = {
    reading: tr("Leggo le analisi salvate", "Reading saved analyses"),
    loading_maia: tr("Carico il modello Maia", "Loading the Maia model"),
    maia: tr("Confronto le posizioni al tuo livello e all’obiettivo", "Comparing positions at your level and goal"),
    saving: tr("Salvo la lettura dei pattern", "Saving your pattern report"),
    profile: tr("Aggiorno il riepilogo del tuo gioco", "Updating your playing summary"),
    coach: tr("Preparo il commento finale", "Preparing the final commentary"),
    stockfish: tr("Esamino le decisioni con Stockfish", "Examining decisions with Stockfish"),
  };
  const label = activity ? labels[activity.stage] : progress?.phase === "analyzing"
    ? labels.stockfish : progress?.phase === "coaching" ? labels.maia
      : tr("Cerco e importo le partite", "Finding and importing games");
  const age = Math.max(0, Math.floor((now - lastChange) / 1000));
  const hasCounter = activity?.completed !== undefined && activity.total !== undefined && activity.total > 0;
  const remaining = hasCounter ? Math.max(0, activity.total! - activity.completed!) : 0;
  const advanced = (activity?.completed ?? 0) - baseline.completed;
  const estimate = hasCounter && remaining > 0 && advanced > 0 && now - baseline.at >= 1000 && age < 30
    ? Math.max(1, Math.ceil(((now - baseline.at) / 1000) * remaining / advanced)) : null;
  return <section className="preparation-status" aria-label={tr("Attività in corso", "Current activity")}>
    {progress?.observing && <p role="status">{tr("L'analisi risulta avviata in un'altra scheda o nella sessione precedente. Qui vedi i risultati salvati; il dettaglio del calcolo è nella scheda che sta lavorando. Se l’hai chiusa, questa pagina riprenderà automaticamente quando si libera la sessione.", "Analysis was started in another tab or the previous session. This page shows saved results; computation details are in the working tab. If you closed it, this page will resume automatically when the session is released.")}</p>}
    <div role="status"><strong>{label}</strong>
      {hasCounter && <><p>{activity.completed} / {activity.total} {activity.stage === "reading" ? tr("partite lette", "games read") : tr("posizioni confrontate", "positions compared")}</p>
        <progress style={{ width: "100%" }} max={activity.total} value={activity.completed} aria-label={label} /></>}
      {hasCounter && <p>{tr("Restano", "Remaining")}: {remaining}. {tr("Avanzamento di questa fase", "Progress for this stage")}: {Math.floor(activity.completed! / activity.total! * 100)}%.</p>}
      {progress?.phase === "analyzing" && <><p>{progress.gamesAnalyzed} / {progress.gamesTotal} {tr("partite analizzate e salvate", "games analysed and saved")}</p>
        {progress.gamesTotal > 0 && <progress style={{ width: "100%" }} max={progress.gamesTotal} value={progress.gamesAnalyzed} aria-label={tr("Partite analizzate", "Analysed games")} />}</>}
      {!activity && progress?.monthsTotal !== undefined && progress.monthsTotal > 0 && progress.phase !== "coaching" && progress.phase !== "analyzing" && <p>{progress.monthsDone} / {progress.monthsTotal} {tr("archivi controllati", "archives checked")} · {progress.gamesDone} {tr("partite raccolte", "games collected")}</p>}
    </div>
    {estimate !== null && <p>{tr("Tempo stimato per questa fase", "Estimated time for this stage")}: {estimate < 60 ? `${estimate} s` : `${Math.ceil(estimate / 60)} min`} · {tr("può variare in base alla posizione e al dispositivo", "may vary by position and device")}.</p>}
    {!progress?.observing && activity?.stage === "loading_maia" && <p>{tr("La stima sarà disponibile dopo i primi confronti. Il modello deve prima essere pronto.", "An estimate will be available after the first comparisons. The model must be ready first.")}</p>}
    <p className="pattern-muted">{tr("Ultimo avanzamento osservato", "Last observed progress")}: {age} s {tr("fa", "ago")}.</p>
    {age >= 30 && <p>{tr("Non sono arrivati nuovi avanzamenti: il calcolo può richiedere tempo. Se cambi scheda o il dispositivo va in sospensione, il browser può rallentare o fermarsi.", "No new progress has arrived: computation can take time. Switching tabs or putting the device to sleep can slow or pause the browser.")}</p>}
  </section>;
}
