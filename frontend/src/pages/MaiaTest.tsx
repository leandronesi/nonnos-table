/**
 * MaiaTest — smoke test dell'engine Maia-3 in-browser.
 *
 * Scopo: verificare A OCCHIO che l'encoding/decoding sia corretto PRIMA di
 * costruirci sopra la pipeline. Se Maia@1900 favorisce mosse forti piu' di
 * Maia@1100 e le probabilita' sono sensate, l'encoding e' giusto.
 *
 * Rotta /maia-test (pubblica, dev). Da rimuovere dopo la verifica.
 */

import { useEffect, useState } from "react";
import { getMaiaEngine, type MaiaStatus, type MaiaEvalResult } from "../pipeline/maia/maiaEngine";

const POSITIONS: { label: string; fen: string }[] = [
  {
    label: "Posizione iniziale (Maia deve preferire e4/d4/Nf3/c4)",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  },
  {
    label: "Italiana, Nero al tratto",
    fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
  },
];

const RATINGS = [1100, 1900];

interface Cell {
  rating: number;
  result: MaiaEvalResult | null;
  error: string | null;
}

export function MaiaTest() {
  const [status, setStatus] = useState<MaiaStatus>("idle");
  const [grid, setGrid] = useState<Cell[][]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const engine = getMaiaEngine();
    let cancelled = false;
    const poll = setInterval(() => {
      if (!cancelled) setStatus(engine.getStatus());
    }, 400);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  async function run() {
    setRunning(true);
    const engine = getMaiaEngine();
    try {
      await engine.waitReady();
    } catch (e) {
      setStatus("error");
      setRunning(false);
      // eslint-disable-next-line no-console
      console.error(e);
      return;
    }
    const out: Cell[][] = [];
    for (const pos of POSITIONS) {
      const row: Cell[] = [];
      for (const r of RATINGS) {
        try {
          const result = await engine.evaluate(pos.fen, r, r);
          row.push({ rating: r, result, error: null });
        } catch (e) {
          row.push({ rating: r, result: null, error: String(e instanceof Error ? e.message : e) });
        }
      }
      out.push(row);
    }
    setGrid(out);
    setRunning(false);
  }

  return (
    <div className="min-h-screen p-6 md:p-10" style={{ background: "var(--color-bg)" }}>
      <div className="max-w-4xl mx-auto">
        <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Maia smoke test</div>
        <h1 className="display-small mt-2">Verifica engine Maia-3</h1>
        <p className="text-sm mt-2" style={{ color: "var(--color-text-soft)" }}>
          Stato worker: <span className="font-mono">{status}</span>
        </p>

        <button onClick={() => void run()} disabled={running} className="btn btn-primary mt-4">
          {running ? "Eseguo…" : "Esegui Maia"}
        </button>

        <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
          Al primo avvio scarica ~44MB (poi cache IndexedDB). Se lo stato resta
          su "error", il modello non e' ancora su Supabase Storage.
        </p>

        <div className="mt-8 space-y-8">
          {POSITIONS.map((pos, pi) => (
            <div key={pi} className="surface surface-padded">
              <div className="label-eyebrow mb-1" style={{ color: "var(--color-muted)" }}>
                Posizione {pi + 1}
              </div>
              <div className="text-sm mb-1">{pos.label}</div>
              <div className="font-mono text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                {pos.fen}
              </div>
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                {(grid[pi] ?? []).map((cell, ci) => (
                  <div key={ci}>
                    <div className="font-mono text-sm font-bold mb-1">
                      Maia {cell.rating}
                      {cell.result != null && (
                        <span style={{ color: "var(--color-muted)", fontWeight: 400 }}>
                          {" "}· win {(cell.result.value * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    {cell.error ? (
                      <div className="text-xs" style={{ color: "var(--color-danger)" }}>{cell.error}</div>
                    ) : cell.result ? (
                      <ol className="text-sm space-y-0.5">
                        {Object.entries(cell.result.policy)
                          .slice(0, 5)
                          .map(([uci, p]) => (
                            <li key={uci} className="flex justify-between font-mono">
                              <span>{uci}</span>
                              <span style={{ color: "var(--color-text-soft)" }} className="tabular-nums">
                                {(p * 100).toFixed(1)}%
                              </span>
                            </li>
                          ))}
                      </ol>
                    ) : (
                      <div className="text-xs" style={{ color: "var(--color-muted)" }}>—</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
