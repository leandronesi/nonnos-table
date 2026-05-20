import { useMemo, useState } from "react";
import type { OpeningAgg } from "../types";

type SortKey = "games" | "win_rate" | "acpl" | "blunders";
type SortDir = "asc" | "desc";

export function OpeningsTable({ rows }: { rows: OpeningAgg[] }) {
  const [colorFilter, setColorFilter] = useState<"all" | "white" | "black">("all");
  const [sortKey, setSortKey] = useState<SortKey>("games");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [minGames, setMinGames] = useState(2);

  const filtered = useMemo(() => {
    let r = [...rows];
    if (colorFilter !== "all") r = r.filter((x) => x.my_color === colorFilter);
    r = r.filter((x) => x.games >= minGames);
    r.sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return r;
  }, [rows, sortKey, sortDir, colorFilter, minGames]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  // Per evidenziare le peggiori per win rate.
  const worstWr = Math.min(...filtered.map((x) => x.win_rate), 1);

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3">
        <div>
          <div className="card-title">Aperture · performance</div>
          <p className="text-slate-400 text-sm mt-1">
            Le aperture dove vai peggio sono dove ti conviene allenarti.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Segmented
            value={colorFilter}
            onChange={(v) => setColorFilter(v as "all" | "white" | "black")}
            options={[
              { v: "all", label: "Tutti" },
              { v: "white", label: "Bianco" },
              { v: "black", label: "Nero" },
            ]}
          />
          <label className="text-xs text-slate-400 flex items-center gap-2">
            min partite
            <input
              type="number"
              min={1}
              value={minGames}
              onChange={(e) => setMinGames(Number(e.target.value) || 1)}
              className="bg-slate-900 border border-[color:var(--color-line)] rounded w-14 px-2 py-1 text-slate-100"
            />
          </label>
        </div>
      </div>

      <div className="overflow-auto -mx-2 px-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <Th>ECO</Th>
              <Th>Apertura</Th>
              <Th>Colore</Th>
              <Th sortable active={sortKey === "games"} dir={sortDir} onClick={() => toggleSort("games")} align="right">
                Partite
              </Th>
              <Th sortable active={sortKey === "win_rate"} dir={sortDir} onClick={() => toggleSort("win_rate")} align="right">
                Win rate
              </Th>
              <Th sortable active={sortKey === "acpl"} dir={sortDir} onClick={() => toggleSort("acpl")} align="right">
                ACPL
              </Th>
              <Th sortable active={sortKey === "blunders"} dir={sortDir} onClick={() => toggleSort("blunders")} align="right">
                Blunder
              </Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const bad = r.win_rate <= worstWr + 0.05;
              return (
                <tr
                  key={`${r.eco}-${r.opening}-${r.my_color}-${i}`}
                  className="border-t border-[color:var(--color-line)]"
                >
                  <td className="py-2 pr-3 font-mono text-slate-300">{r.eco}</td>
                  <td className="py-2 pr-3">{r.opening}</td>
                  <td className="py-2 pr-3">
                    <ColorPill color={r.my_color} />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.games}</td>
                  <td
                    className={
                      "py-2 pr-3 text-right tabular-nums " +
                      (bad ? "text-[color:var(--color-danger)] font-semibold" : "")
                    }
                  >
                    {(r.win_rate * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.acpl}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.blunders}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  Nessuna apertura corrisponde ai filtri.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  sortable,
  active,
  dir,
  onClick,
  align,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
  align?: "right";
}) {
  const cls =
    "py-2 pr-3 text-xs uppercase tracking-wider " +
    (align === "right" ? "text-right " : "") +
    (sortable ? "cursor-pointer select-none hover:text-slate-200 " : "") +
    (active ? "text-[color:var(--color-brand-soft)]" : "");
  return (
    <th className={cls} onClick={onClick}>
      {children}
      {sortable && active && <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

function ColorPill({ color }: { color: "white" | "black" | "?" }) {
  if (color === "white")
    return <span className="inline-flex items-center gap-1.5"><Dot c="#e6e9f5" /> Bianco</span>;
  if (color === "black")
    return <span className="inline-flex items-center gap-1.5"><Dot c="#1f2740" outline /> Nero</span>;
  return <span className="text-slate-500">—</span>;
}
function Dot({ c, outline }: { c: string; outline?: boolean }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: c, border: outline ? "1px solid #6b7393" : undefined }}
    />
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
}) {
  return (
    <div className="inline-flex bg-slate-900 border border-[color:var(--color-line)] rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={
            "px-3 py-1 rounded-md text-xs transition " +
            (value === o.v
              ? "bg-[color:var(--color-brand)] text-white shadow"
              : "text-slate-300 hover:text-white")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
