import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useTavoloData } from "./tavolo/useTavoloData";
import { loadPatternAttempts } from "../patternLearningStore";
import { buildPatternLearning, type LearningAttempt, type PatternLearning } from "../pipeline/patternLearning";
import { PATTERN_CATALOG, type PatternKind } from "../pipeline/personalPatterns";
import { tr } from "../i18n/lang";
import "./pattern-coach.css";

export function PatternProgressView({ patterns, coverageKnown }: { patterns: PatternLearning[]; coverageKnown: boolean }) {
  return <>
    <p className="pattern-kicker">{tr("Il tuo percorso", "Your progress")}</p>
    <h1>{tr("Dall'esercizio alla partita.", "From practice to play.")}</h1>
    <p>{tr("Qui distinguiamo ciò che riesci a fare in allenamento da quello che succede quando torni a giocare.", "Here we separate what you do in practice from what happens when you return to playing.")}</p>
    {!coverageKnown && <p role="status">{tr("La lettura attuale non contiene ancora le opportunità necessarie per confrontare le partite. Aggiornala dal quaderno.", "The current report does not yet contain the opportunities needed to compare games. Refresh it from the notebook.")}</p>}
    {!patterns.length && <section className="pattern-focus"><h2>{tr("Il percorso comincia da una scelta.", "Progress starts with a choice.")}</h2>
      <p>{tr("Completa un primo esercizio su un tuo pattern. Poi potremo osservare le nuove occasioni nelle partite concluse dopo quell'allenamento.", "Complete a first exercise on one of your patterns. Then we can observe new opportunities in games completed after that practice.")}</p>
      <Link className="pattern-primary" to="/sessione">{tr("Scegli un allenamento", "Choose a practice")}</Link></section>}
    {patterns.map((pattern) => {
      const catalog = PATTERN_CATALOG[pattern.patternId.split(":")[0] as PatternKind];
      if (!catalog) return null;
      const before = pattern.baseline;
      const after = pattern.subsequent;
      return <section className="pattern-section" key={pattern.patternId}>
        <p className="pattern-kicker">{tr("Primo esercizio", "First exercise")}: {new Date(pattern.firstPracticedAt).toLocaleDateString()}</p>
        <h2>{tr(catalog.title, catalog.titleEn)}</h2>
        <div className="progress-columns"><div>
          <h3>{tr("In allenamento", "In practice")}</h3>
          <p className="progress-count">{pattern.practiceSuccesses} <span>/ {pattern.practiceAttempts}</span></p>
          <p>{tr("risposte accettabili secondo il motore", "acceptable replies according to the engine")}</p>
          <p className="pattern-muted">{pattern.practiceWithHint} {tr("tentativi con aiuto", "attempts with a hint")}</p>
        </div><div>
          <h3>{tr("Nelle partite successive", "In subsequent games")}</h3>
          <p className="progress-count">{after.opportunities - after.errors} <span>/ {after.opportunities}</span></p>
          <p>{tr("occasioni senza errori rilevanti", "opportunities without substantial errors")}</p>
          <p className="pattern-muted">{after.games} {tr("partite diverse, escludendo quelle usate per allenarti", "different games, excluding those used for practice")}</p>
        </div></div>
        <h3>{tr("Prima e dopo, sulle occasioni osservate", "Before and after, on observed opportunities")}</h3>
        <dl className="pattern-numbers"><div><dt>{tr("Errori prima dell'allenamento", "Errors before practice")}</dt><dd>{before.errors} / {before.opportunities}</dd></div>
          <div><dt>{tr("Errori dopo l'allenamento", "Errors after practice")}</dt><dd>{after.errors} / {after.opportunities}</dd></div></dl>
        {pattern.errorRateChange === null ? <p className="pattern-muted">{tr("Servono almeno 8 occasioni in 3 partite in ciascun periodo per interpretare il confronto. Zero occasioni non significa zero errori.", "At least 8 opportunities across 3 games in each period are needed to interpret the comparison. Zero opportunities does not mean zero errors.")}</p>
          : <p>{tr("La quota di errori è", "The error share is")} {pattern.errorRateChange < 0 ? tr("scesa", "down") : pattern.errorRateChange > 0 ? tr("salita", "up") : tr("invariata", "unchanged")}
            {pattern.errorRateChange !== 0 && ` ${Math.abs(Math.round(pattern.errorRateChange * 100))} ${tr("punti percentuali", "percentage points")}`}.</p>}
        {pattern.patternId.startsWith("time_reserve:") && <>
          <h3>{tr("Stai cambiando il ritmo delle scelte?", "Is your decision pace changing?")}</h3>
          <p>{tr("Decisioni veloci con tempo disponibile", "Quick decisions with time available")}: {before.fast} / {before.timingKnown} {tr("prima", "before")}; {after.fast} / {after.timingKnown} {tr("dopo", "after")}.</p>
          <p className="pattern-muted">{tr("Leggi il ritmo insieme alla qualità delle mosse. Pensare più a lungo, da solo, non è l'obiettivo.", "Read pace alongside move quality. Thinking longer alone is not the goal.")}</p>
        </>}
        <p className="pattern-muted">{tr("Il confronto usa le partite nel campione attuale, nella stessa cadenza e fase. Descrive un cambiamento osservato, non dimostra che l'allenamento lo abbia causato.", "The comparison uses games in the current sample, within the same time control and phase. It describes an observed change, not proof that practice caused it.")}</p>
        <Link className="pattern-primary" to={`/sessione?pattern=${encodeURIComponent(pattern.patternId)}`}>{tr("Torna ad allenarlo", "Practice it again")}</Link>
      </section>;
    })}
  </>;
}

export function PatternProgress() {
  const { user } = useAuth();
  const data = useTavoloData();
  const [attempts, setAttempts] = useState<LearningAttempt[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setAttempts(null); setError(false);
    loadPatternAttempts(user.id).then((rows) => { if (!cancelled) setAttempts(rows); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [user?.id, retry]);
  const observations = data.aggregates?.personal_patterns?.observations;
  const learning = useMemo(() => buildPatternLearning(observations ?? [], attempts ?? []), [observations, attempts]);
  return <div className="pattern-coach">
    {error ? <div role="alert"><p>{tr("Non riesco a leggere lo storico degli esercizi.", "I cannot load practice history.")}</p><button type="button" onClick={() => setRetry(retry + 1)}>{tr("Riprova", "Try again")}</button></div>
      : data.error ? <p role="alert">{data.error}</p>
      : data.loading || attempts === null ? <p role="status">{tr("Confronto esercizi e partite…", "Comparing practice and games…")}</p>
      : <PatternProgressView patterns={learning.patterns.filter((p) => p.patternId.split(":")[0] in PATTERN_CATALOG)} coverageKnown={observations !== undefined} />}
    <Link className="pattern-back" to="/quaderno">{tr("Apri il quaderno", "Open notebook")} →</Link>
  </div>;
}
