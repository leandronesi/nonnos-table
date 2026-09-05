import { AuthShell } from "./AuthShell";
import type { OrchestratorProgress } from "../../pipeline/orchestrator";
import { FIRST_BATCH_SIZE, FREE_GAME_CAP } from "../../pipeline/config";
import { tr } from "../../i18n/lang";

export function AnalysisPreparation({ progress, error, ready, username, onEnter, onRetry, onExit }: {
  progress: OrchestratorProgress | null;
  error: string | null;
  ready: boolean;
  username: string;
  onEnter: () => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  const phase = progress?.phase ?? "pending";
  const failed = Boolean(error) || phase === "error";
  const selected = progress?.corpusFinalized ? progress.gamesTotal : null;
  const analyzed = progress?.gamesAnalyzed ?? 0;
  const firstTarget = selected == null ? FIRST_BATCH_SIZE : Math.min(FIRST_BATCH_SIZE, selected);
  const steps = [tr("Raccogliamo le partite", "Collecting games"), tr("Osserviamo le decisioni", "Examining decisions"), tr("Colleghiamo i pattern", "Connecting patterns")];
  const active = ready ? 3 : phase === "coaching" ? 2 : phase === "analyzing" ? 1 : 0;
  return <AuthShell eyebrow={tr("LE TUE PARTITE, INSIEME", "YOUR GAMES, TOGETHER")}
    title={ready ? tr("La prima lettura è pronta.", "Your first reading is ready.") : failed ? tr("Riprendiamo da qui.", "Let's pick up here.") : tr("Cerchiamo ciò che ritorna.", "Looking for what recurs.")}
    subtitle={<>{username && <strong>{username} · </strong>}{tr("Pattern, qualità delle scelte e uso del tempo.", "Patterns, decision quality and use of time.")}</>}>
    <ol className="preparation-steps">{steps.map((label, index) => <li key={index} data-state={index < active ? "done" : index === active ? "active" : "next"} aria-current={index === active ? "step" : undefined}><span aria-hidden="true">{index < active ? "✓" : index + 1}</span>{label}</li>)}</ol>
    <section className="preparation-counts" aria-label={tr("Avanzamento analisi", "Analysis progress")}>
      <div><strong>{analyzed}</strong><span>{tr("partite analizzate", "games analysed")}</span></div>
      <div><strong>{selected ?? "—"}</strong><span>{selected == null ? tr("corpus in raccolta", "collecting the corpus") : tr("partite selezionate", "games selected")}</span></div>
    </section>
    {!ready && !failed && <div role="status" className="preparation-status">
      {phase === "analyzing" && firstTarget > 0 ? <><progress max={firstTarget} value={Math.min(analyzed, firstTarget)} aria-label={tr("Prima lettura", "First reading")} /><p>{tr(`Prima lettura: ${Math.min(analyzed, firstTarget)} di ${firstTarget} analisi riuscite.`, `First reading: ${Math.min(analyzed, firstTarget)} of ${firstTarget} successful analyses.`)}</p></> : <p>{phase === "coaching" ? tr("Le posizioni vengono collegate per cercare abitudini ricorrenti.", "Connecting positions to find recurring habits.") : tr("Controlliamo le partite disponibili della cadenza scelta.", "Checking available games from the chosen time control.")}</p>}
    </div>}
    {failed && <div role="alert" className="preparation-error"><p>{error || tr("L’analisi si è interrotta. Puoi riprovare dal punto salvato.", "Analysis stopped. You can retry from the saved point.")}</p><button type="button" className="btn btn-primary" onClick={onRetry}>{tr("Riprendi l’analisi", "Resume analysis")}</button></div>}
    {ready && <><p className="onboarding-note">{tr("Puoi già esplorare gli esempi. Con poche partite, alcuni pattern potrebbero non avere ancora abbastanza prove.", "You can explore the examples now. With few games, some patterns may still need more evidence.")}</p><button type="button" className="btn btn-primary w-full" onClick={onEnter}>{tr("Apri il tuo gioco", "Open your game")}</button></>}
    <div className="preparation-note"><h2>{tr("Il browser sta lavorando", "Your browser does the work")}</h2><p>{tr(`L’analisi può richiedere diversi minuti. Tieni questa pagina aperta per farla avanzare. Dopo la prima lettura continuiamo fino a ${FREE_GAME_CAP} partite; se chiudi la scheda, alla riapertura riprendiamo dal punto salvato.`, `Analysis can take several minutes. Keep this page open to make progress. After the first reading, we continue to up to ${FREE_GAME_CAP} games; if you close the tab, we resume from the saved point when you return.`)}</p></div>
    <button type="button" className="btn btn-ghost w-full" onClick={onExit}>{tr("Esci dall’account", "Sign out")}</button>
  </AuthShell>;
}
