import { AnalysisActivityStatus } from "../components/AnalysisActivityStatus";
import type { OrchestratorProgress } from "../pipeline/orchestrator";
import { Link } from "react-router-dom";
import { useTavoloData, type TavoloData } from "./tavolo/useTavoloData";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { TimingPatterns } from "../components/TimingPatterns";
import { PatternCards, patternTitle } from "./PatternLibrary";
import { PATTERN_CATALOG } from "../pipeline/personalPatterns";
import { tr } from "../i18n/lang";
import "./pattern-coach.css";

/** The player's recurring decisions are the entry point; explanations never require an LLM. */
export function PatternHome() {
  const data = useTavoloData();
  const run = useOnboardingRun();
  return <PatternHomeView data={data} run={run} />;
}

export type PatternHomeData = Pick<TavoloData, "aggregates" | "refreshing" | "reanalyzing" | "loading" | "error" | "refreshError" | "refreshNotice" | "currentRating" | "targetRating" | "liveGoal" | "runRefreshHandler">;
export type PatternHomeRun = Pick<ReturnType<typeof useOnboardingRun>, "backgroundRunning" | "silentRefreshing" | "backgroundError" | "backgroundCoverage" | "retryBackground"> & { progress?: OrchestratorProgress | null };

export function PatternHomeView({ data, run }: { data: PatternHomeData; run: PatternHomeRun }) {
  const report = data.aggregates;
  const busy = data.refreshing || data.reanalyzing || run.backgroundRunning || run.silentRefreshing;
  const timingPriority = report?.timing?.strata.find((p) => p.evidence === "recurring_errors");
  const anchors = (report?.anchors ?? []).filter((a) => a.games_with >= 3);
  const first = anchors[0];
  const patterns = report?.personal_patterns?.patterns;
  const comparison = report?.personal_patterns;
  const comparisonIsOlder = comparison && ((data.currentRating !== null && comparison.currentRating !== data.currentRating) || comparison.targetRating !== data.targetRating);
  const priority = patterns?.find((p) => p.evidence === "recurring");

  return <div className="pattern-coach">
    <header className="pattern-page-heading">
      <div><p className="pattern-kicker">{tr("Al tavolo con Nonno", "At the table with Nonno")}</p>
        <h1>{tr("Conosci il tuo gioco.", "Understand your game.")}</h1>
        <p>{tr("Le abitudini che tornano nelle tue partite. Una direzione per il prossimo passo.", "The habits that recur in your games. A direction for your next step.")}</p></div>
      <Link className="pattern-goal" to="/settings#obiettivo" aria-label={tr("Il tuo obiettivo", "Your goal")}>
        <span>{tr("Il tuo percorso", "Your journey")}</span>
        <strong>{data.currentRating ?? "—"} <span aria-hidden="true">→</span> {data.targetRating}</strong>
        <span>{data.liveGoal?.time_class ?? report?.analysis_scope?.time_class ?? ""}</span>
      </Link>
    </header>

    <div className="pattern-data-bar">
      <span>{report ? `${report.games_analyzed} ${tr("partite nella lettura", "games in this report")}` : tr("Carico le tue partite…", "Loading your games…")}</span>
      <button type="button" disabled={busy || data.loading} onClick={() => void data.runRefreshHandler()}>
        {busy ? tr("Aggiornamento in corso…", "Updating…") : tr("Aggiorna le partite", "Refresh games")}
      </button>
    </div>
    {comparisonIsOlder && <p className="pattern-muted" role="status">
      {tr("Il confronto Maia di questa lettura usa", "This report's Maia comparison uses")} {comparison.currentRating ?? "—"} → {comparison.targetRating}.
      {" "}{tr("Il livello di partenza viene dalle partite analizzate e può differire dal rating aggiornato su Chess.com.", "The starting level comes from the analyzed games and may differ from your updated Chess.com rating.")}
      {comparison.targetRating !== data.targetRating && <> {tr("Aggiorna le partite per usare il nuovo obiettivo nel confronto.", "Refresh your games to use your new goal in the comparison.")}</>}
    </p>}
    {busy && <AnalysisActivityStatus progress={run.progress} />}
    {data.loading && <p role="status">{tr("Sto preparando la tua lettura.", "Preparing your report.")}</p>}
    {(data.error || data.refreshError) && <p role="alert">{data.error || data.refreshError}</p>}
    {data.refreshNotice && <p role="status">{data.refreshNotice}</p>}
    {run.backgroundRunning && <p role="status">{tr("La lettura è provvisoria: sto analizzando le altre partite. Puoi già esplorare quelle pronte.", "This report is provisional: other games are being analyzed. You can explore the completed ones.")}</p>}
    {run.backgroundError && <div role="alert"><p>{run.backgroundError}</p><button type="button" onClick={run.retryBackground}>{tr("Riprendi l'analisi", "Resume analysis")}</button></div>}
    {run.backgroundCoverage && run.backgroundCoverage.failed > 0 && <p>{tr("Alcune partite non sono state analizzate: la lettura copre solo quelle riuscite.", "Some games could not be analyzed: this report covers completed games only.")}</p>}

    {report && <>
      <section className="pattern-focus" aria-labelledby="focus-title">
        <p className="pattern-kicker">{tr("Da dove partire", "Where to start")}</p>
        <h2 id="focus-title">{priority ? patternTitle(priority) : timingPriority ? tr("Hai tempo. A volte scegli prima di usarlo.", "You have time. Sometimes you choose before using it.")
          : first?.label_it ?? tr("Cerchiamo ciò che si ripete.", "Look for what repeats.")}</h2>
        <p>{priority ? tr(PATTERN_CATALOG[priority.kind].action, PATTERN_CATALOG[priority.kind].actionEn) : timingPriority
          ? tr(`Nel contesto osservato, ${timingPriority.fastWithTime.errors} errori compaiono in ${timingPriority.fastWithTime.opportunities} decisioni veloci con tempo disponibile, su ${timingPriority.fastWithTime.games} partite. Guardiamone alcune insieme.`, `In the observed context, ${timingPriority.fastWithTime.errors} errors appear in ${timingPriority.fastWithTime.opportunities} quick decisions with time available, across ${timingPriority.fastWithTime.games} games. Let's examine a few.`)
          : first?.meaning_it ?? tr("Ogni lettura parte dalle occasioni concrete. Con poche partite, le prime indicazioni restano provvisorie.", "Every report starts from actual opportunities. With few games, early findings remain provisional.")}</p>
        <div className="pattern-actions">
          {priority ? <Link className="pattern-primary" to={`/quaderno?pattern=${encodeURIComponent(priority.id)}`}>{tr("Guarda le decisioni", "Explore these decisions")}</Link>
            : timingPriority ? <a className="pattern-primary" href="#cronometro">{tr("Guarda le decisioni", "Explore these decisions")}</a>
            : first ? <Link className="pattern-primary" to="/quaderno#percorso">{tr("Esplora le prove", "Explore the evidence")}</Link> : null}
          <Link to="/sessione">{tr("Vai all'allenamento", "Go to training")} <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <TimingPatterns report={report.timing} />

      <section className="pattern-section" aria-labelledby="recurrences-title">
        <div className="pattern-section-heading"><div><p className="pattern-kicker">{tr("Situazioni ricorrenti", "Recurring situations")}</p>
          <h2 id="recurrences-title">{tr("Cosa torna nelle tue partite", "What recurs in your games")}</h2></div>
          <Link to="/quaderno#percorso">{tr("Apri il quaderno", "Open notebook")}</Link></div>
        {patterns ? <PatternCards patterns={patterns.slice(0, 4)} /> : <>
        {anchors.length === 0 && <p>{tr("Non abbiamo ancora un segnale che ricorra in almeno tre partite. Puoi esplorare gli esempi disponibili nel quaderno.", "There is no signal recurring in at least three games yet. You can explore available examples in the notebook.")}</p>}
        <div className="pattern-list">{anchors.map((anchor) => <article key={anchor.type}>
          <p className="pattern-kicker">{anchor.games_with} {tr("partite", "games")} · {anchor.count} {tr("errori osservati", "observed errors")}</p>
          <h3>{anchor.label_it}</h3><p>{anchor.action_it}</p>
          {typeof anchor.mine_acceptable_observed_policy_pct === "number" && Number.isFinite(anchor.mine_acceptable_observed_policy_pct)
            && typeof anchor.target_acceptable_observed_policy_pct === "number" && Number.isFinite(anchor.target_acceptable_observed_policy_pct) && <p className="pattern-muted">
            {tr("Sulle alternative valide esaminate, sostegno Maia", "Maia support for the examined valid alternatives")}: {anchor.mine_acceptable_observed_policy_pct.toFixed(0)} → {anchor.target_acceptable_observed_policy_pct.toFixed(0)} / 100.
            {" "}{tr("Livello attuale → obiettivo; confronto del modello sugli errori selezionati.", "Current level → goal; model comparison on selected errors.")}
          </p>}
          <Link to="/quaderno#percorso">{tr("Approfondisci", "Explore")} <span aria-hidden="true">→</span></Link>
        </article>)}</div>
        <p className="pattern-muted">{tr("Queste categorie descrivono gli errori rilevati. I valori Maia sono segnali del modello, non percentuali di giocatori né punti Elo guadagnabili.", "These categories describe detected errors. Maia values are model signals, not player percentages or potential Elo gains.")}</p>
        </>}
      </section>
      <section className="pattern-section pattern-next"><h2>{tr("Porta una cosa nella prossima partita.", "Take one idea into your next game.")}</h2>
        <p>{tr("Scegli un aspetto su cui lavorare, allenalo e torna a guardare come lo affronti nelle partite nuove. Il quaderno conserva le prove; il cronometro racconta anche come hai deciso.", "Choose one aspect to work on, practice it, then see how you handle it in new games. The notebook holds the evidence; the clock also tells how you decided.")}</p>
        <Link className="pattern-primary" to="/sessione">{tr("Allenati sulle tue posizioni", "Practice your positions")}</Link>
      </section>
    </>}
    {!data.loading && !report && <section className="pattern-section"><h2>{tr("La tua lettura deve ancora arrivare.", "Your report is not ready yet.")}</h2>
      <p>{tr("Aggiorna le partite per preparare i primi esempi e i pattern personali.", "Refresh your games to prepare your first examples and personal patterns.")}</p></section>}
  </div>;
}
