import { useMemo, useState } from "react";
import type { BlunderRow, Phase } from "../types";
import { BlunderCard } from "./BlunderCard";

interface Props {
  blunders: BlunderRow[];
}

export function BlunderReview({ blunders }: Props) {
  const [phase, setPhase] = useState<Phase | "all">("all");
  const [motif, setMotif] = useState<string | "all">("all");
  const [page, setPage] = useState(0);
  const pageSize = 8;

  const motifs = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const b of blunders) {
      if (!b.motif) continue;
      const cur = m.get(b.motif);
      if (cur) cur.n += 1;
      else m.set(b.motif, { label: b.motif_label || b.motif, n: 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [blunders]);

  const filtered = useMemo(() => {
    return blunders.filter((b) => {
      if (phase !== "all" && b.phase !== phase) return false;
      if (motif !== "all" && b.motif !== motif) return false;
      return true;
    });
  }, [blunders, phase, motif]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <div className="card mt-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <div className="card-title">Blunder review · banca posizioni</div>
          <p className="text-slate-400 text-sm mt-1">
            Le tue {blunders.length} peggiori mosse. Per ogni posizione: cosa hai giocato, cosa
            dovevi giocare, e perché.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Fase"
            value={phase}
            onChange={(v) => {
              setPhase(v as Phase | "all");
              setPage(0);
            }}
            options={[
              { v: "all", label: "Tutte" },
              { v: "opening", label: "Apertura" },
              { v: "middlegame", label: "Mediogioco" },
              { v: "endgame", label: "Finale" },
            ]}
          />
          <div className="inline-flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-1">Motivo</span>
            <select
              value={motif}
              onChange={(e) => {
                setMotif(e.target.value);
                setPage(0);
              }}
              className="bg-slate-900 border border-[color:var(--color-line)] rounded-lg px-2 py-1 text-xs"
            >
              <option value="all">Tutti</option>
              {motifs.map(([m, info]) => (
                <option key={m} value={m}>
                  {info.label} ({info.n})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-slate-500 text-sm mt-4">Nessun blunder con questi filtri.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
            {slice.map((b) => (
              <BlunderCard key={`${b.game_id}-${b.ply}`} blunder={b} size={220} />
            ))}
          </div>

          <div className="flex items-center justify-between mt-5 text-sm">
            <span className="text-slate-500">
              {safePage * pageSize + 1}-{Math.min(filtered.length, (safePage + 1) * pageSize)} di{" "}
              {filtered.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                className="px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] text-slate-300 hover:bg-slate-800 disabled:opacity-30 transition"
              >
                ← Prec
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
                className="px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] text-slate-300 hover:bg-slate-800 disabled:opacity-30 transition"
              >
                Succ →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-1">{label}</span>
      <div className="inline-flex bg-slate-900 border border-[color:var(--color-line)] rounded-lg p-0.5">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={
              "px-2.5 py-1 rounded-md text-xs transition " +
              (value === o.v
                ? "bg-[color:var(--color-brand)] text-white"
                : "text-slate-300 hover:text-white")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
