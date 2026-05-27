import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { PawnStructure } from "../types";

interface Props {
  structures: PawnStructure[];
  /** Limite massimo da mostrare. Default 5. */
  limit?: number;
  /** Titolo opzionale del pannello. */
  title?: string;
  /** Frase di contesto sotto al titolo. */
  description?: string;
}

/**
 * StructuresPanel — il piano strategico del mediogioco, non singole mosse.
 *
 * Mostra le strutture pedonali in cui giochi più frequentemente, con
 * win-rate, gravità media degli errori (avg cp_loss) e motif tattico
 * dominante quando cadi in quella struttura. Sortate per impatto (peggio
 * fai = priorità più alta).
 */
export function StructuresPanel({
  structures,
  limit = 5,
  title = "Le strutture in cui cadi",
  description = "Il mediogioco è strategia, non tattica. Queste sono le strutture pedonali dove il tuo win-rate scende — capirle vale più di drillare singole mosse.",
}: Props) {
  if (!structures || structures.length === 0) return null;

  // Sort per "impact": low win_rate × high n_games × high cp_loss
  const sorted = structures
    .slice()
    .filter((s) => s.confidence !== "low")
    .sort((a, b) => structureImpact(b) - structureImpact(a))
    .slice(0, limit);

  return (
    <section className="structures-panel">
      <header className="structures-panel-head">
        <h2 className="display-small">{title}</h2>
        <p className="structures-panel-desc">{description}</p>
      </header>
      <div className="structures-list">
        {sorted.map((s) => (
          <StructureRow key={s.key} s={s} />
        ))}
      </div>
    </section>
  );
}

function StructureRow({ s }: { s: PawnStructure }) {
  const wrPct = s.win_rate != null ? Math.round(s.win_rate * 100) : null;
  const wrTone = wrPct == null ? "neutral" : wrPct < 35 ? "bad" : wrPct < 50 ? "warn" : "good";
  return (
    <Link
      to={`/strutture/${encodeURIComponent(s.key)}`}
      className={`structure-row structure-row-${wrTone}`}
    >
      <div className="structure-row-main">
        <h3 className="structure-row-name">
          {s.label_it}
          <ChevronRight size={16} aria-hidden="true" className="structure-row-chev" />
        </h3>
        <p className="structure-row-meta">
          <strong>{s.n_games}</strong> partite · <strong>{s.n_positions}</strong> posizioni di mediogioco
          {s.dominant_motif && (
            <> · errore tipico: <strong>{s.dominant_motif.toLowerCase()}</strong></>
          )}
        </p>
      </div>
      <div className="structure-row-stats">
        {wrPct != null && (
          <div className={`structure-stat structure-stat-${wrTone}`}>
            <div className="structure-stat-val">{wrPct}%</div>
            <div className="structure-stat-lbl">win-rate</div>
          </div>
        )}
        <div className="structure-stat">
          <div className="structure-stat-val">
            −{(s.avg_cp_loss / 100).toFixed(1)}
          </div>
          <div className="structure-stat-lbl">cp_loss medio</div>
        </div>
      </div>
    </Link>
  );
}

/**
 * Score di impatto: combina win-rate (basso = pesa di più) × n_games (più dati
 * = più grave) × cp_loss medio. Ritorna un numero non normalizzato.
 */
function structureImpact(s: PawnStructure): number {
  const wr = s.win_rate ?? 0.5;
  const wrBadness = Math.max(0, 0.5 - wr); // 0..0.5
  return (1 + wrBadness * 4) * Math.log10(s.n_games + 1) * (s.avg_cp_loss / 100);
}
