import type { Metrics } from "../types";
import { type FilterState, listMonths, listTimeClasses } from "../filters";

interface Props {
  metrics: Metrics;
  filters: FilterState;
  onUpdate: <K extends keyof FilterState>(k: K, v: FilterState[K]) => void;
  onReset: () => void;
  filteredCount: number;
}

export function FiltersBar({ metrics, filters, onUpdate, onReset, filteredCount }: Props) {
  const months = listMonths(metrics);
  const tcs = listTimeClasses(metrics);

  return (
    <div className="card mt-6 flex flex-col lg:flex-row lg:items-end gap-4">
      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
          Cadenza
        </label>
        <select
          value={filters.timeClass}
          onChange={(e) => onUpdate("timeClass", e.target.value as FilterState["timeClass"])}
          className="bg-slate-900 border border-[color:var(--color-line)] rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">Tutte</option>
          {tcs.map((tc) => (
            <option key={tc} value={tc}>{tc}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
          Rated
        </label>
        <select
          value={filters.rated}
          onChange={(e) => onUpdate("rated", e.target.value as FilterState["rated"])}
          className="bg-slate-900 border border-[color:var(--color-line)] rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">Tutte</option>
          <option value="rated">Solo rated</option>
          <option value="unrated">Solo unrated</option>
        </select>
      </div>

      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
          Dal mese
        </label>
        <select
          value={filters.monthFrom || ""}
          onChange={(e) => onUpdate("monthFrom", e.target.value || null)}
          className="bg-slate-900 border border-[color:var(--color-line)] rounded-lg px-3 py-2 text-sm"
        >
          <option value="">—</option>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
          Al mese
        </label>
        <select
          value={filters.monthTo || ""}
          onChange={(e) => onUpdate("monthTo", e.target.value || null)}
          className="bg-slate-900 border border-[color:var(--color-line)] rounded-lg px-3 py-2 text-sm"
        >
          <option value="">—</option>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="text-xs text-slate-400">{filteredCount} partite filtrate</div>
        <button
          onClick={onReset}
          className="text-xs px-3 py-2 rounded-lg border border-[color:var(--color-line)] text-slate-300 hover:bg-slate-800 transition"
        >
          Reset filtri
        </button>
      </div>
    </div>
  );
}
