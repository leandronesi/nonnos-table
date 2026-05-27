import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dumbbell, X } from "lucide-react";
import type { PlayerModel } from "../types";
import { PageShell } from "./PageShell";
import { PatternCard } from "../components/PatternCard";
import { buildPatterns, categoryLabel, type Pattern, type PatternCategory } from "../patterns";
import { startQueue } from "../session/drillQueue";

type FilterKey = "all" | "fresh" | "tactic" | "non-tactic";
type SortKey = "impact" | "trend" | "recent";

interface Props {
  pm: PlayerModel;
}

/**
 * Patterns collection — l'utente vede tutti i pattern, ne seleziona uno o
 * piu`, e parte un allenamento sequenziale (drill queue) sui pattern scelti.
 */
export function Patterns({ pm }: Props) {
  const windowDays = pm.growth_delta?.window_days ?? 14;
  const subtitle = pm.growth_delta?.as_of
    ? `Aggiornato al ${pm.growth_delta.as_of} · finestra ${windowDays}gg`
    : `Finestra ${windowDays}gg`;
  return (
    <PageShell title="I tuoi freni" subtitle={subtitle}>
      <PatternsBody pm={pm} />
    </PageShell>
  );
}

/**
 * Body riusabile della collezione Patterns. Esposto come componente per
 * embed nel Quaderno (/coach) come tab "Cadute". Senza PageShell, senza
 * subtitle: solo contenuto.
 */
export function PatternsBody({ pm }: { pm: PlayerModel }) {
  const navigate = useNavigate();
  const patterns = useMemo(() => buildPatterns(pm), [pm]);
  const windowDays = pm.growth_delta?.window_days ?? 14;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("impact");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const goal = pm.identity.goal;
  const targetLabel = `${goal.target} ${(goal.time_class ?? "rapid").toLowerCase()}`;

  const drillablePatterns = useMemo(
    () => new Set(patterns.filter((p) => p.positions.length > 0).map((p) => p.key)),
    [patterns],
  );

  const filtered = useMemo(() => {
    let out = patterns.slice();
    if (filter === "fresh") out = out.filter((p) => p.srs_state === "fresh");
    if (filter === "tactic") out = out.filter((p) => p.category === "tactic");
    if (filter === "non-tactic") out = out.filter((p) => p.category !== "tactic");
    return out.sort(sorter(sort));
  }, [patterns, filter, sort]);

  function toggleSelect(key: string) {
    if (!drillablePatterns.has(key)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function clearSelected() { setSelected(new Set()); }
  function startTraining() {
    if (selected.size === 0) return;
    const ordered = filtered.filter((p) => selected.has(p.key)).map((p) => p.key);
    startQueue(ordered);
    navigate(`/patterns/${encodeURIComponent(ordered[0])}/drill`);
  }

  return (
    <>
      <section className="patterns-intro surface surface-padded mb-6">
        <div className="label-eyebrow">Verso il tuo obiettivo: <strong>{targetLabel}</strong></div>
        <h2 className="display-medium mt-2">Le cose che ti tengono sotto.</h2>
        <p className="text-[color:var(--color-text-soft)] leading-relaxed mt-3 max-w-2xl">
          Ogni voce è un freno tra te e il tuo target. Sortati di default per <strong>impatto</strong> —
          combina frequenza, evitabilità al tuo livello e gravità. Più alto in lista = più ti pesa.
          Seleziona i freni che vuoi allenare oggi, poi "Inizia allenamento" in basso.
        </p>
      </section>

      <div className="patterns-controls">
        <div className="patterns-filter-group" role="radiogroup" aria-label="Filtro pattern">
          <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>
            Tutti <span className="patterns-count">{patterns.length}</span>
          </FilterBtn>
          <FilterBtn active={filter === "fresh"} onClick={() => setFilter("fresh")}>
            Da allenare <span className="patterns-count">{patterns.filter((p) => p.srs_state === "fresh").length}</span>
          </FilterBtn>
          <FilterBtn active={filter === "tactic"} onClick={() => setFilter("tactic")}>
            Tattica
          </FilterBtn>
          <FilterBtn active={filter === "non-tactic"} onClick={() => setFilter("non-tactic")}>
            Mentale & altro
          </FilterBtn>
        </div>
        <div className="patterns-sort">
          <label htmlFor="sort">Ordina:</label>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="impact">Impatto (quanto ti frena)</option>
            <option value="trend">Trend (peggiori prima)</option>
            <option value="recent">Più recenti</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="patterns-empty surface surface-padded">
          <h3 className="display-small">Nessun pattern in questa vista.</h3>
          <p className="text-[color:var(--color-text-soft)] mt-2">
            Cambia filtro o torna più tardi quando avrai giocato altre partite.
          </p>
        </div>
      ) : (
        <div className="patterns-grid">
          {filtered.map((p) => (
            <PatternCard
              key={p.key}
              pattern={p}
              windowDays={windowDays}
              selectable={drillablePatterns.has(p.key)}
              selected={selected.has(p.key)}
              onToggleSelect={() => toggleSelect(p.key)}
            />
          ))}
        </div>
      )}

      <CategoryLegend patterns={patterns} />

      {selected.size > 0 && (
        <div className="patterns-train-bar" role="region" aria-label="Allenamento selezionato">
          <div className="patterns-train-bar-info">
            <Dumbbell size={18} aria-hidden="true" />
            <strong>{selected.size}</strong> pattern in coda
            {selected.size > 1 && <span className="text-[color:var(--color-text-soft)]"> · li alleni in fila</span>}
          </div>
          <div className="patterns-train-bar-actions">
            <button onClick={clearSelected} className="btn btn-ghost btn-sm" aria-label="Svuota selezione">
              <X size={14} aria-hidden="true" /> Svuota
            </button>
            <button onClick={startTraining} className="btn btn-primary btn-lg">
              Inizia allenamento ({selected.size})
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function FilterBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`patterns-filter-btn ${active ? "active" : ""}`}
    >
      {children}
    </button>
  );
}

function sorter(sort: SortKey) {
  if (sort === "impact") return (a: Pattern, b: Pattern) => b.impact_score - a.impact_score;
  if (sort === "trend") {
    const w = { worsening: 0, stable: 1, improving: 2 } as const;
    return (a: Pattern, b: Pattern) => w[a.trend] - w[b.trend] || b.impact_score - a.impact_score;
  }
  // recent
  return (a: Pattern, b: Pattern) => {
    const da = a.last_occurrence?.date ?? "";
    const db = b.last_occurrence?.date ?? "";
    return db.localeCompare(da);
  };
}

function CategoryLegend({ patterns }: { patterns: Pattern[] }) {
  const present = new Set<PatternCategory>(patterns.map((p) => p.category));
  const order: PatternCategory[] = ["tactic", "timing", "psych", "decision", "phase", "color"];
  return (
    <aside className="patterns-legend">
      <div className="label-eyebrow">Categorie</div>
      <div className="patterns-legend-row">
        {order.filter((c) => present.has(c)).map((c) => (
          <span key={c} className="patterns-legend-item">
            <span className="patterns-legend-dot" style={{ background: `var(--cat-${c}, currentColor)` }} />
            {categoryLabel(c)}
          </span>
        ))}
      </div>
    </aside>
  );
}
