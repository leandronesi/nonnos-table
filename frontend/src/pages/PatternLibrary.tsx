import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTavoloData } from "./tavolo/useTavoloData";
import { BoardView } from "../components/BoardView";
import { PATTERN_CATALOG, type PatternOpportunity, type PersonalPattern, type PersonalPatternReport } from "../pipeline/personalPatterns";
import { tr } from "../i18n/lang";
import { uciToSan } from "./quaderno/boardArrows";
import "./pattern-coach.css";

export function patternTitle(pattern: PersonalPattern): string {
  const entry = PATTERN_CATALOG[pattern.kind];
  return tr(entry.title, entry.titleEn);
}

function scopeLabel(scope: string): string {
  const [cadence, base, increment, phase] = scope.split(":");
  const time = base === "unknown" || increment === "unknown" ? tr("cadenza incompleta", "incomplete time control") : `${Number(base) / 60}+${increment}`;
  const phaseName = phase === "middlegame" ? tr("mediogioco", "middlegame") : phase === "endgame" ? tr("finale", "endgame") : tr("apertura", "opening");
  return `${time} · ${cadence} · ${phaseName}`;
}

export function PatternCards({ patterns }: { patterns: PersonalPattern[] }) {
  return <div className="pattern-list">{patterns.map((pattern) => <article key={pattern.id}>
    <p className="pattern-kicker">{pattern.evidence === "recurring" ? tr("Su cui lavorare", "Work on this")
      : pattern.evidence === "insufficient" ? tr("Prime osservazioni", "Early observations") : tr("Da seguire nel tempo", "Track over time")}</p>
    <h3>{patternTitle(pattern)}</h3>
    <p>{pattern.errors} {tr("errori su", "errors in")} {pattern.opportunities} {tr("occasioni", "opportunities")} · {pattern.games} {tr("partite", "games")}</p>
    <p className="pattern-muted">{scopeLabel(pattern.scope)}</p>
    <Link to={`/quaderno?pattern=${encodeURIComponent(pattern.id)}`}>{tr("Apri il pattern", "Open pattern")} <span aria-hidden="true">→</span></Link>
  </article>)}</div>;
}

export function PatternPosition({ position }: { position: PatternOpportunity }) {
  const [showAlternative, setShowAlternative] = useState(false);
  const best = position.bestUci;
  return <div className="pattern-evidence-layout">
    <div className="pattern-board"><BoardView fen={position.fen} orientation={position.color} size={480}
      arrows={showAlternative && best ? [{ from: best.slice(0, 2), to: best.slice(2, 4), color: "#c28b40" }] : []} /></div>
    <div><p className="pattern-kicker">{new Date(position.playedAt).toLocaleDateString()} · {tr("Mossa", "Move")} {Math.ceil(position.ply / 2)}</p>
      <h3>{tr("La posizione prima della scelta", "The position before choosing")}</h3>
      <p>{tr("In partita hai giocato", "In the game you played")} <strong>{position.playedSan}</strong>.</p>
      {position.timing.status === "available" ? <dl className="pattern-numbers">
        <div><dt>{tr("Tempo disponibile", "Time available")}</dt><dd>{Math.floor(position.timing.clockBeforeSeconds! / 60)}:{String(Math.floor(position.timing.clockBeforeSeconds! % 60)).padStart(2, "0")}</dd></div>
        <div><dt>{tr("Tempo impiegato", "Time spent")}</dt><dd>{position.timing.spentSeconds} s</dd></div>
      </dl> : <p className="pattern-muted">{tr("Il cronometro di questa decisione non è ricostruibile dai dati disponibili.", "This decision's clock cannot be reconstructed from available data.")}</p>}
      {best && <button type="button" aria-pressed={showAlternative} onClick={() => setShowAlternative(!showAlternative)}>
        {showAlternative ? tr("Nascondi l'alternativa", "Hide alternative") : tr("Mostra un'alternativa", "Show an alternative")}
      </button>}
      {showAlternative && <p className="pattern-alternative"><strong>{uciToSan(position.fen, best)}</strong> · {tr("alternativa suggerita dal motore", "engine-suggested alternative")}</p>}
    </div>
  </div>;
}

export function PersonalPatternDetail({ pattern, report }: { pattern: PersonalPattern; report: PersonalPatternReport }) {
  const [tab, setTab] = useState<"errors" | "successes">("errors");
  const [selected, setSelected] = useState(0);
  const examples = tab === "errors" ? pattern.examples : pattern.successfulExamples;
  const position = examples[selected] ?? examples[0];
  const catalog = PATTERN_CATALOG[pattern.kind];
  return <>
    <Link className="pattern-back" to="/quaderno">← {tr("Tutti i pattern", "All patterns")}</Link>
    <header className="pattern-page-heading"><div><p className="pattern-kicker">{tr("Il tuo quaderno", "Your notebook")}</p>
      <h1>{patternTitle(pattern)}</h1><p>{tr(catalog.action, catalog.actionEn)}</p></div></header>
    <p className="pattern-kicker">{scopeLabel(pattern.scope)}</p>
    <Link className="pattern-primary" to={`/sessione?pattern=${encodeURIComponent(pattern.id)}`}>{tr("Allenati su questo pattern", "Practice this pattern")}</Link>
    <dl className="pattern-numbers">
      <div><dt>{tr("Occasioni osservate", "Observed opportunities")}</dt><dd>{pattern.opportunities}</dd></div>
      <div><dt>{tr("Partite diverse", "Distinct games")}</dt><dd>{pattern.games}</dd></div>
      <div><dt>{pattern.kind === "time_reserve" ? tr("Errori decidendo in fretta", "Errors deciding quickly") : tr("Errori nel pattern", "Pattern errors")}</dt><dd>{pattern.errors}</dd></div>
      <div><dt>{tr("Scelte che hanno mantenuto la posizione", "Choices preserving the position")}</dt><dd>{pattern.handled}</dd></div>
    </dl>
    {pattern.evidence === "insufficient" && <p className="pattern-muted">{tr("Questa è una prima osservazione. Non ci sono ancora abbastanza occasioni in partite diverse per assegnarle una priorità.", "This is an early observation. There are not enough opportunities across different games to assign a priority yet.")}</p>}
    <section className="pattern-section"><h2>{tr("I livelli usati in questa lettura", "The levels used in this report")}</h2>
      <p>{report.currentRating ?? "—"} → {report.targetRating}</p>
      {pattern.maia.currentSupport !== null && pattern.maia.targetSupport !== null ? <>
        <dl className="pattern-numbers"><div><dt>{tr("Sostegno Maia al livello attuale", "Maia support at your current level")}</dt><dd>{Math.round(pattern.maia.currentSupport * 100)} / 100</dd></div>
          <div><dt>{tr("Sostegno Maia al livello obiettivo", "Maia support at your goal level")}</dt><dd>{Math.round(pattern.maia.targetSupport * 100)} / 100</dd></div></dl>
        <p className="pattern-muted">{tr("Sostegno del modello alle alternative valide esaminate, sulle stesse posizioni e tenendo fisso il livello dell'avversario. Non è la percentuale di persone che risolverebbero il problema.", "Model support for the examined valid alternatives, on the same positions and keeping the opponent level fixed. This is not the percentage of people who would solve the problem.")}</p>
      </> : <p>{tr("Il confronto di livello non ha ancora copertura sufficiente. Le prove delle tue partite restano disponibili.", "The level comparison does not yet have enough coverage. Your game evidence remains available.")}</p>}
      <p className="pattern-muted">Maia: {pattern.maia.scored} / {pattern.maia.eligible} {tr("occasioni valutate. Il campione comprende scelte riuscite ed errori; i rating della piattaforma non sono automaticamente equivalenti a quelli del modello.", "opportunities evaluated. The sample includes successful choices and errors; platform ratings are not automatically equivalent to the model's ratings.")}</p>
    </section>
    <section className="pattern-section"><h2>{tr("Le prove, sulle tue scacchiere", "The evidence, on your boards")}</h2>
      <div className="pattern-choice-row">
        <button type="button" aria-pressed={tab === "errors"} onClick={() => { setTab("errors"); setSelected(0); }}>{tr("Errori", "Errors")} ({pattern.examples.length})</button>
        <button type="button" aria-pressed={tab === "successes"} onClick={() => { setTab("successes"); setSelected(0); }}>{tr("Scelte riuscite", "Successful choices")} ({pattern.successfulExamples.length})</button>
      </div>
      <div className="pattern-choice-row">{examples.map((item, index) => <button type="button" key={item.id} aria-pressed={selected === index} onClick={() => setSelected(index)}>{tr("Partita", "Game")} {index + 1}</button>)}</div>
      {position ? <PatternPosition key={position.id} position={position} /> : <p>{tr("Nessun esempio di questo tipo nel campione.", "No example of this type in the sample.")}</p>}
      <p className="pattern-muted">{tr("Gli esempi provengono da partite diverse. I temi tattici sono riconosciuti dalla geometria e dalle alternative del motore: la classificazione può essere incompleta.", "Examples come from different games. Tactical themes are recognized from geometry and engine alternatives: classification can be incomplete.")}</p>
    </section>
  </>;
}

export function PatternLibrary() {
  const data = useTavoloData();
  const [params] = useSearchParams();
  const report = data.aggregates?.personal_patterns;
  const id = params.get("pattern");
  const selected = report?.patterns.find((p) => p.id === id);
  return <div className="pattern-coach">
    {data.loading ? <p role="status">{tr("Apro il tuo quaderno…", "Opening your notebook…")}</p>
      : data.error ? <p role="alert">{data.error}</p>
      : selected && report ? <PersonalPatternDetail key={selected.id} pattern={selected} report={report} />
      : <>
        <p className="pattern-kicker">{tr("Il tuo quaderno", "Your notebook")}</p>
        <h1>{tr("Le situazioni che tornano.", "The situations that recur.")}</h1>
        <p>{tr("Esplora cosa succede nelle tue partite, come usi il tempo e quali scelte riesci già a gestire.", "Explore what happens in your games, how you use time and which choices you already handle well.")}</p>
        {id && <p role="status">{tr("Questo pattern non compare nella lettura attuale. Qui trovi quelli disponibili.", "This pattern is not in your current report. Available patterns are listed here.")}</p>}
        {report?.patterns.length ? <PatternCards patterns={report.patterns} /> : <p>{tr("Aggiorna le partite per costruire la lettura dei pattern sulle occasioni osservate.", "Refresh your games to build a pattern report from observed opportunities.")}</p>}
        <button type="button" disabled={data.refreshing || data.reanalyzing} onClick={() => void data.runRefreshHandler()}>{data.refreshing ? tr("Aggiornamento…", "Updating…") : tr("Aggiorna le partite", "Refresh games")}</button>
        {data.refreshError && <p role="alert">{data.refreshError}</p>}
        {data.refreshNotice && <p role="status">{data.refreshNotice}</p>}
      </>}
  </div>;
}
