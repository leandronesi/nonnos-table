import { useState } from "react";
import { MovePlayback } from "./MovePlayback";
import { tr } from "../i18n/lang";
import type { TimingExample, TimingReport, TimingStratum } from "../pipeline/decisionTiming";

function clock(seconds: number): string {
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function PositionEvidence({ positions }: { positions: TimingExample[] }) {
  const [selected, setSelected] = useState(0);
  const position = positions[selected] ?? positions[0];
  if (!position) return null;
  const date = new Date(position.playedAt);
  return <div className="pattern-evidence">
    <div className="pattern-choice-row" aria-label={tr("Esempi dalle partite", "Game examples")}>
      {positions.map((item, i) => <button type="button" key={item.positionId}
        aria-pressed={i === selected} onClick={() => setSelected(i)}>
        {tr("Partita", "Game")} {i + 1}
      </button>)}
    </div>
    <div className="pattern-evidence-layout">
      <div className="pattern-board"><MovePlayback key={position.positionId} fen={position.fenBefore}
        orientation={position.fenBefore.split(" ")[1] === "b" ? "black" : "white"}
        lines={[{ label: tr("La tua mossa", "Your move"), moves: [position.playedUci] },
          ...(position.bestMoveUci ? [{ label: tr("Alternativa del motore", "Engine alternative"), moves: [position.bestMoveUci] }] : [])]} /></div>
      <div>
        <p className="pattern-kicker">{Number.isFinite(date.getTime()) ? date.toLocaleDateString() : tr("Data non disponibile", "Date unavailable")}
          {" · "}{tr("Mossa", "Move")} {Math.ceil(position.ply / 2)}</p>
        <h4>{tr("Prima della tua decisione", "Before your decision")}</h4>
        <dl className="pattern-numbers">
          <div><dt>{tr("Tempo a disposizione", "Time available")}</dt><dd>{clock(position.clockBeforeSeconds)}</dd></div>
          <div><dt>{tr("Tempo impiegato", "Time spent")}</dt><dd>{position.spentSeconds.toLocaleString()} s</dd></div>
        </dl>
        <p className="pattern-muted">{position.cpLoss < 50
          ? tr("Qui la decisione rapida ha mantenuto la qualità della posizione secondo il motore.", "Here the quick decision preserved the position's quality according to the engine.")
          : tr("Qui velocità ed errore compaiono insieme. Questo non dimostra che pensare più a lungo avrebbe evitato l'errore.", "Speed and an error occur together here. This does not prove that thinking longer would have prevented the error.")}</p>
      </div>
    </div>
  </div>;
}

function TimingDetail({ pattern }: { pattern: TimingStratum }) {
  const fast = pattern.fastWithTime;
  const comparison = pattern.consideredWithTime;
  return <details className="pattern-detail">
    <summary>
      <span><span className="pattern-kicker">{pattern.baseSeconds / 60}+{pattern.incrementSeconds} · {pattern.timeClass} · {pattern.phase === "opening" ? tr("apertura", "opening") : pattern.phase === "endgame" ? tr("finale", "endgame") : tr("mediogioco", "middlegame")}</span>
        <strong>{pattern.context === "narrow_choice"
          ? tr("Scelte strette, risposte veloci", "Narrow choices, quick replies")
          : tr("Decisioni veloci con tempo disponibile", "Quick decisions with time available")}</strong>
        <span className="pattern-muted">{fast.errors} {tr("errori su", "errors in")} {fast.opportunities} {tr("decisioni veloci", "quick decisions")} · {fast.games} {tr("partite", "games")}</span>
      </span><span aria-hidden="true">＋</span>
    </summary>
    <div className="pattern-detail-body">
      <p>{tr("Hai mosso entro", "You moved within")} <strong>{pattern.thresholds.fastSeconds} s</strong>,
        {" "}{tr("con almeno", "with at least")} <strong>{clock(pattern.thresholds.ampleSeconds)}</strong> {tr("ancora disponibili prima di scegliere.", "still available before choosing.")}</p>
      <p>{tr("Contesto", "Context")}: {pattern.phase === "opening" ? tr("apertura", "opening") : pattern.phase === "endgame" ? tr("finale", "endgame") : tr("mediogioco", "middlegame")}
        {pattern.context === "narrow_choice" && tr("; le prime due alternative del motore hanno una differenza rilevante. Questo segnala una scelta delicata, non misura la difficoltà per te.", "; the engine's first two alternatives differ substantially. This signals a consequential choice, not your personal difficulty.")}</p>
      <dl className="pattern-numbers">
        <div><dt>{tr("Errori nelle decisioni veloci", "Errors in quick decisions")}</dt><dd>{fast.errors} / {fast.opportunities}</dd></div>
        <div><dt>{tr("Errori prendendoti più tempo", "Errors taking more time")}</dt><dd>{comparison.errors} / {comparison.opportunities}</dd></div>
      </dl>
      <p className="pattern-muted">{pattern.errorRateDifference === null
        ? tr("Il confronto tra i due gruppi richiede almeno 8 occasioni in 3 partite per ciascuno. Per ora mostriamo i conteggi.", "Comparing the two groups requires at least 8 opportunities across 3 games in each. For now we show counts.")
        : tr("Confronto osservato nella stessa cadenza, fase e tipo di scelta. Le posizioni possono comunque avere difficoltà diverse.", "Observed comparison within the same time control, phase and choice type. Positions can still differ in difficulty.")}</p>
      {pattern.evidence === "recurring_errors" && <div className="pattern-coach-note">
        <strong>{tr("Una cosa da provare nelle prossime partite", "Something to try in your next games")}</strong>
        <p>{tr("Quando hai tempo e la posizione cambia, controlla scacchi, catture e minacce dell'avversario prima di scegliere. L'obiettivo è riconoscere quando serve una pausa, non rallentare ogni mossa.", "When you have time and the position changes, check your opponent's checks, captures and threats before choosing. Learn when a pause helps, without slowing down every move.")}</p>
      </div>}
      {pattern.examples.length > 0 && <><h4>{tr("Dove è comparso l'errore", "Where the error appeared")}</h4><PositionEvidence positions={pattern.examples} /></>}
      {pattern.successfulExamples.length > 0 && <><h4>{tr("Quando hai deciso bene anche in fretta", "When a quick decision worked")}</h4><PositionEvidence positions={pattern.successfulExamples} /></>}
      <h4>{tr("Nelle partite più recenti", "In your most recent games")}</h4>
      {pattern.trend ? <>
        <p>{tr("Decisioni veloci quando avevi tempo", "Quick decisions when you had time")}: {pattern.trend.recent.opportunities} / {pattern.trend.recentWithTime.opportunities}
          {" "}{tr("nelle ultime 10 partite;", "in the latest 10 games;")} {pattern.trend.previous.opportunities} / {pattern.trend.previousWithTime.opportunities}
          {" "}{tr("nelle 10 precedenti.", "in the previous 10.")}</p>
        <p>{tr("Ultime 10", "Latest 10")}: {pattern.trend.recent.errors} / {pattern.trend.recent.opportunities}.
          {" "}{tr("10 precedenti", "Previous 10")}: {pattern.trend.previous.errors} / {pattern.trend.previous.opportunities}.</p>
        <p className="pattern-muted">{pattern.trend.errorRateDifference === null
          ? tr("Occasioni ancora insufficienti per leggere una tendenza.", "Not enough opportunities to interpret a trend yet.")
          : tr("Sono errori sulle decisioni veloci con riserva di tempo. Questa tendenza descrive le partite e non dimostra l'effetto dell'allenamento.", "These are errors in quick decisions with time in reserve. This trend describes your games and does not prove a training effect.")}</p>
      </> : <p className="pattern-muted">{tr("Servono almeno 20 partite della stessa cadenza e incremento per confrontare due gruppi di 10.", "At least 20 games with the same time control and increment are needed to compare two groups of 10.")}</p>}
    </div>
  </details>;
}

export function TimingPatterns({ report, compact = false }: { report: TimingReport | undefined; compact?: boolean }) {
  const [expanded, setExpanded] = useState(!compact);
  return <section id="cronometro" className="pattern-section" aria-labelledby="timing-title">
    <div className="pattern-section-heading"><div><p className="pattern-kicker">{tr("Il tuo uso del tempo", "Your use of time")}</p>
      <h2 id="timing-title">{tr("Il cronometro fa parte della scelta.", "The clock is part of the choice.")}</h2></div></div>
    {compact && report && <>
      <p>{tr("Quando avevi tempo, quando eri sotto pressione: guarda le tue decisioni nei due casi.", "When you had time and when you were under pressure: explore your decisions in both situations.")}</p>
      <button type="button" aria-expanded={expanded} aria-controls="timing-evidence" onClick={() => setExpanded(!expanded)}>
        {expanded ? tr("Chiudi i dettagli del cronometro", "Close clock details") : tr("Esplora il tuo uso del tempo", "Explore your use of time")}
      </button>
    </>}
    <div id="timing-evidence" hidden={Boolean(report) && !expanded}>
    {!report ? <p>{tr("Questa lettura non contiene ancora l'analisi del cronometro. Aggiorna le partite per ricostruirla dai dati disponibili.", "This report does not contain clock analysis yet. Refresh your games to rebuild it from available data.")}</p> : <>
      <p className="pattern-muted">{tr("Tempo ricostruito su", "Timing reconstructed for")} {report.measuredMoves} / {report.moves} {tr("mosse", "moves")}.
        {" "}{tr("Le mosse iniziali, le risposte obbligate riconosciute e le posizioni già nettamente decise sono escluse dai pattern temporali.", "Early opening moves, recognized forced replies and already clearly decided positions are excluded from timing patterns.")}</p>
      {report.strata.filter((p) => p.fastWithTime.opportunities > 0).map((pattern) => <TimingDetail key={pattern.key} pattern={pattern} />)}
      {!report.strata.some((p) => p.fastWithTime.opportunities > 0) && <p>{report.measuredMoves === 0
        ? tr("Non ci sono dati del cronometro sufficienti per questa lettura. Le partite devono includere il tempo residuo per mossa e la cadenza.", "There is not enough clock data for this report. Games must include remaining time per move and the time control.")
        : tr("Nel campione disponibile non emergono decisioni veloci con ampia riserva nei contesti osservati.", "No quick decisions with ample reserve appear in the observed contexts of this sample.")}</p>}
      {report.strata.some((p) => p.underPressure.opportunities > 0) && <details className="pattern-detail">
        <summary><strong>{tr("Quando invece il tempo scarseggia", "When time is actually running low")}</strong><span aria-hidden="true">＋</span></summary>
        <div className="pattern-detail-body"><p>{tr("Queste scelte sono separate dalla fretta con tempo disponibile: prima di muovere avevi una riserva bassa.", "These choices are separate from rushing with time available: your reserve was low before moving.")}</p>
          {report.strata.filter((p) => p.underPressure.opportunities > 0).map((p) => <p key={p.key}>
            <strong>{p.baseSeconds / 60}+{p.incrementSeconds}</strong> · {p.phase === "endgame" ? tr("finale", "endgame") : p.phase === "opening" ? tr("apertura", "opening") : tr("mediogioco", "middlegame")}
            {" · "}{p.context === "narrow_choice" ? tr("scelta stretta", "narrow choice") : tr("altre scelte", "other choices")}: {p.underPressure.errors} {tr("errori su", "errors in")} {p.underPressure.opportunities}
            {" "}{tr("occasioni, con al massimo", "opportunities, with at most")} {clock(p.thresholds.pressureSeconds)} {tr("prima di scegliere.", "before choosing.")}
          </p>)}</div>
      </details>}
    </>}
    </div>
  </section>;
}
