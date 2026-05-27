import { Link } from "react-router-dom";
import { Check, CheckCircle2 } from "lucide-react";
import type { Pattern } from "../patterns";
import {
  categoryLabel,
  categoryColor,
  formatSharePct,
  srsColor,
  srsLabel,
  trendArrow,
  trendColor,
  trendLabel,
} from "../patterns";
import { PatternSparkline } from "./PatternSparkline";
import { InfoHint } from "./InfoHint";
import { patternStats } from "../session/drillLog";

interface Props {
  pattern: Pattern;
  windowDays?: number;
  /** Se true: renderizzata come Link verso detail. Default true. */
  asLink?: boolean;
  /** Selezionabile per la drill queue (mostra checkbox). */
  selectable?: boolean;
  /** Stato selezione corrente. */
  selected?: boolean;
  /** Callback toggle selezione. */
  onToggleSelect?: () => void;
}

/**
 * Carta Pattern — core content (Step 2 OOUX):
 *   Nome · Frequenza % · Trend · Ultima volta · Stato SRS
 *
 * Cliccabile (Link) verso /patterns/:key — l'oggetto è navigabile. Quando
 * `selectable=true`, mostra anche un checkbox che NON ruba il click al Link
 * (cliccare il checkbox fa solo toggle, il resto della card naviga).
 */
export function PatternCard({
  pattern,
  windowDays = 14,
  asLink = true,
  selectable = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const inner = (
    <PatternCardInner
      pattern={pattern}
      windowDays={windowDays}
      selectable={selectable}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
  const cls = `pattern-card ${selected ? "pattern-card-selected" : ""}`;
  if (!asLink) return <article className={cls}>{inner}</article>;
  return (
    <Link to={`/patterns/${encodeURIComponent(pattern.key)}`} className={`${cls} pattern-card-link`}>
      {inner}
    </Link>
  );
}

function PatternCardInner({
  pattern, windowDays, selectable, selected, onToggleSelect,
}: {
  pattern: Pattern;
  windowDays: number;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const cColor = categoryColor(pattern.category);
  const tColor = trendColor(pattern.trend);
  const sColor = srsColor(pattern.srs_state);
  const drillStats = patternStats(pattern.key);
  return (
    <>
      <header className="pattern-card-head">
        <div className="pattern-card-cat" style={{ color: cColor }}>
          <span className="pattern-card-cat-dot" style={{ background: cColor }} />
          {categoryLabel(pattern.category)}
          {drillStats.done_today && (
            <span className="pattern-card-drilled-today" title="Allenato oggi">
              <CheckCircle2 size={12} aria-hidden="true" /> allenato
            </span>
          )}
        </div>
        <div className="pattern-card-head-right">
          <div className="pattern-card-srs" style={{ color: sColor, borderColor: `${sColor}55` }}>
            {srsLabel(pattern.srs_state)}
          </div>
          {selectable && (
            <button
              type="button"
              className={`pattern-card-checkbox ${selected ? "checked" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSelect?.();
              }}
              aria-pressed={selected}
              aria-label={selected ? "Rimuovi dalla coda di allenamento" : "Aggiungi alla coda di allenamento"}
              title={selected ? "Rimuovi dalla coda" : "Aggiungi alla coda di allenamento"}
            >
              {selected ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true">+</span>}
            </button>
          )}
        </div>
      </header>

      <h3 className="pattern-card-name">{pattern.name}</h3>

      <div className="pattern-card-row">
        <div className="pattern-card-stat">
          <div className="pattern-card-stat-value">{formatSharePct(pattern.current_share)}</div>
          <div className="pattern-card-stat-label">
            delle partite ultimi {windowDays}gg
            <InfoHint text={`Percentuale di partite — degli ultimi ${windowDays} giorni — in cui hai commesso questo errore almeno una volta. Indipendente da quante partite hai giocato.`} />
          </div>
        </div>
        <div className="pattern-card-stat">
          <div className="pattern-card-stat-value" style={{ color: tColor }}>
            <span aria-hidden="true">{trendArrow(pattern.trend)}</span> {trendLabel(pattern.trend)}
          </div>
          <div className="pattern-card-stat-label">
            era {formatSharePct(pattern.previous_share)} · {windowDays}gg precedenti
          </div>
        </div>
      </div>

      <div className="pattern-card-sparkline">
        <PatternSparkline
          series={pattern.weekly_series}
          width={260}
          height={48}
          color={tColor}
          ariaLabel={`andamento ${pattern.name}`}
        />
      </div>

      <footer className="pattern-card-foot">
        {pattern.avoidable_count > 0 ? (
          <span className="pattern-card-avoidable" title="Numero di posizioni evitabili al tuo livello — sono le piu` 'money' da allenare">
            <strong>{pattern.avoidable_count}</strong> evitabili al tuo livello
          </span>
        ) : pattern.positions.length > 0 ? (
          <span className="pattern-card-foot-empty">
            {pattern.positions.length} occorrenze · difficili anche al tuo target
          </span>
        ) : (
          <span className="pattern-card-foot-empty">Nessuna posizione taggata</span>
        )}
        {drillStats.total_runs > 0 && (
          <span className="pattern-card-drilled-count" title="Quante volte hai allenato questo pattern in totale">
            allenato {drillStats.total_runs}×
          </span>
        )}
        {pattern.last_occurrence && (
          <span className="pattern-card-last">
            <strong>{pattern.last_occurrence.date}</strong>
          </span>
        )}
      </footer>
    </>
  );
}
