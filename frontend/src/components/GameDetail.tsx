import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GameAnalysis } from "../types";
import { BoardView } from "./BoardView";
import { squaresOfSan, fmtEval } from "../chess-utils";

interface Props {
  gameId: string;
  onClose: () => void;
}

const CAT_COLOR: Record<string, string> = {
  ok: "transparent",
  inaccuracy: "var(--color-inaccuracy)",
  mistake: "var(--color-mistake)",
  blunder: "var(--color-blunder)",
};

function safeId(id: string): string {
  return id.replace(/[/:?&]/g, "_");
}

async function loadGameAnalysis(gameId: string): Promise<GameAnalysis | null> {
  // Carica il file di analisi per il game_id, prima dal server, poi da percorso statico.
  // Su GitHub Pages, copiamo i singoli payload dentro frontend/public/analysis/.
  const id = safeId(gameId);
  const base = import.meta.env.BASE_URL || "/";
  const candidates = [
    `${base}analysis/${id}.json`,
    `${base}data/analysis/${id}.json`,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch {
      // ignore
    }
  }
  return null;
}

export function GameDetail({ gameId, onClose }: Props) {
  const [data, setData] = useState<GameAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plyIdx, setPlyIdx] = useState(0); // index nella sequenza fens (0 = posizione iniziale)

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setPlyIdx(0);
    loadGameAnalysis(gameId).then(
      (d) => {
        if (cancelled) return;
        if (!d) {
          setError(
            "Analisi non disponibile per questa partita. Su deploy statici, esporta le analisi singole con `python backend/export_analysis.py` (vedi README).",
          );
        } else {
          setData(d);
        }
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (!data) return;
      const max = data.analysis.fens.length - 1;
      if (e.key === "ArrowRight") setPlyIdx((i) => Math.min(max, i + 1));
      if (e.key === "ArrowLeft") setPlyIdx((i) => Math.max(0, i - 1));
      if (e.key === "Home") setPlyIdx(0);
      if (e.key === "End") setPlyIdx(max);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, onClose]);

  // Mappa ply → analisi della MIA mossa giocata in quel ply (se esiste)
  const myMoveByPly = useMemo(() => {
    const m = new Map<number, GameAnalysis["analysis"]["moves"][number]>();
    if (!data) return m;
    for (const mv of data.analysis.moves) m.set(mv.ply, mv);
    return m;
  }, [data]);

  const evalChartData = useMemo(() => {
    if (!data) return [];
    return data.analysis.evals_my_pov.map((cp, i) => ({ ply: i, cp }));
  }, [data]);

  if (error) {
    return (
      <Overlay onClose={onClose}>
        <div className="text-sm text-slate-300">{error}</div>
      </Overlay>
    );
  }
  if (!data) {
    return (
      <Overlay onClose={onClose}>
        <div className="text-sm text-slate-400">Carico l'analisi…</div>
      </Overlay>
    );
  }

  const fen = data.analysis.fens[plyIdx] || data.analysis.fens[0];
  const myColor = data.index.my_color;
  const orientation = myColor;

  // Highlight + arrow per la MIA mossa nel ply corrente (se esiste)
  const playedNow = myMoveByPly.get(plyIdx);
  let highlights: { square: string; color: string }[] = [];
  let arrows: { from: string; to: string; color?: string }[] = [];
  if (playedNow && playedNow.fen_before) {
    const sq = squaresOfSan(playedNow.fen_before, playedNow.san);
    const best =
      playedNow.best_san ? squaresOfSan(playedNow.fen_before, playedNow.best_san) : null;
    if (sq) {
      highlights.push({ square: sq.from, color: "#ef444466" });
      highlights.push({ square: sq.to, color: "#ef4444" });
      arrows.push({ from: sq.from, to: sq.to, color: "#ef4444" });
    }
    if (best) {
      highlights.push({ square: best.from, color: "#22c55e66" });
      highlights.push({ square: best.to, color: "#22c55e" });
      if (!sq || sq.from !== best.from || sq.to !== best.to) {
        arrows.push({ from: best.from, to: best.to, color: "#22c55e" });
      }
    }
  }

  const totalPlies = data.analysis.fens.length - 1;
  const idx = data.index;

  return (
    <Overlay onClose={onClose}>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT — scacchiera */}
        <div className="flex-shrink-0">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-slate-500">
                {idx.time_class} · {new Date((idx.end_time_epoch || 0) * 1000).toLocaleString("it-IT")}
              </div>
              <div className="text-base text-slate-200">
                Tu ({myColor}, <b>{idx.my_rating}</b>) vs <b>{idx.opp_rating}</b>{" "}
                <ResultBadge result={idx.result} />
              </div>
              <div className="text-sm text-slate-400">{idx.opening || "—"}</div>
            </div>
            {idx.url && (
              <a
                href={idx.url}
                target="_blank"
                rel="noreferrer"
                className="text-[color:var(--color-brand-soft)] text-sm hover:underline"
              >
                Apri su Chess.com →
              </a>
            )}
          </div>

          <BoardView fen={fen} orientation={orientation} size={420} highlights={highlights} arrows={arrows} />

          <div className="flex items-center justify-between mt-3 gap-2">
            <button
              onClick={() => setPlyIdx(0)}
              className="px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] hover:bg-slate-800 text-sm"
            >
              ⏮
            </button>
            <button
              onClick={() => setPlyIdx((i) => Math.max(0, i - 1))}
              className="px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] hover:bg-slate-800 text-sm"
            >
              ← Prec
            </button>
            <div className="text-xs text-slate-400 tabular-nums">
              ply {plyIdx} / {totalPlies}
            </div>
            <button
              onClick={() => setPlyIdx((i) => Math.min(totalPlies, i + 1))}
              className="px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] hover:bg-slate-800 text-sm"
            >
              Succ →
            </button>
            <button
              onClick={() => setPlyIdx(totalPlies)}
              className="px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] hover:bg-slate-800 text-sm"
            >
              ⏭
            </button>
          </div>

          {playedNow && (
            <div className="mt-3 p-3 rounded-lg border border-[color:var(--color-line)] bg-slate-900/60 text-sm">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-slate-400">Mossa {playedNow.move_number}</span>
                <span
                  className="font-mono font-semibold"
                  style={{ color: CAT_COLOR[playedNow.category] || "#cbd5e1" }}
                >
                  {playedNow.san}
                </span>
                <span className="text-slate-500 text-xs">
                  {fmtEval(playedNow.cp_before)} → {fmtEval(playedNow.cp_after)} · perdita{" "}
                  {playedNow.cp_loss}cp · {playedNow.category}
                </span>
              </div>
              {playedNow.best_san && playedNow.best_san !== playedNow.san && (
                <div className="flex items-baseline gap-2 flex-wrap mt-1">
                  <span className="text-slate-400">Meglio:</span>
                  <span className="text-green-300 font-mono font-semibold">{playedNow.best_san}</span>
                  {playedNow.pv_san.length > 1 && (
                    <span className="text-slate-500 text-xs font-mono">
                      {playedNow.pv_san.slice(0, 5).join(" ")}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — eval chart + move list */}
        <div className="flex-1 min-w-0">
          <div className="card !p-3 mb-4">
            <div className="text-xs text-slate-500 mb-1">Andamento valutazione (dal tuo punto di vista)</div>
            <div className="h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={evalChartData}
                  margin={{ top: 4, right: 4, left: -10, bottom: 0 }}
                  onClick={(e) => {
                    if (e && typeof e.activeLabel === "number") setPlyIdx(e.activeLabel);
                  }}
                >
                  <defs>
                    <linearGradient id="evalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.55} />
                      <stop offset="50%" stopColor="#22c55e" stopOpacity={0.05} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="ply" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
                  <YAxis tickLine={false} axisLine={false} width={40} domain={[-1000, 1000]} />
                  <Tooltip formatter={(v: number) => [fmtEval(v), "Eval"]} />
                  <ReferenceLine y={0} stroke="var(--color-muted)" strokeDasharray="2 2" />
                  <ReferenceLine x={plyIdx} stroke="var(--color-brand-soft)" />
                  <Area
                    type="monotone"
                    dataKey="cp"
                    stroke="#7c5cff"
                    strokeWidth={2}
                    fill="url(#evalGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card !p-3">
            <div className="text-xs text-slate-500 mb-2">
              Le tue mosse · clicca per saltare alla posizione
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-[420px] overflow-auto pr-1">
              {data.analysis.moves.map((m) => {
                const active = plyIdx === m.ply;
                return (
                  <button
                    key={m.ply}
                    onClick={() => setPlyIdx(m.ply)}
                    className={
                      "text-left px-2 py-1.5 rounded-md border text-xs transition flex items-baseline gap-2 " +
                      (active
                        ? "border-[color:var(--color-brand)] bg-[color:var(--color-brand)]/15"
                        : "border-[color:var(--color-line)] hover:bg-slate-800/60")
                    }
                  >
                    <span className="text-slate-500 w-6 text-right tabular-nums">{m.move_number}.</span>
                    <span
                      className="font-mono font-semibold"
                      style={{ color: m.category === "ok" ? "#cbd5e1" : CAT_COLOR[m.category] }}
                    >
                      {m.san}
                    </span>
                    {m.category !== "ok" && (
                      <span className="text-slate-500 ml-auto text-[10px] tabular-nums">
                        −{m.cp_loss}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-3 text-[11px] text-slate-500">
              <Legend color={CAT_COLOR.inaccuracy} label="Imprecisione" />
              <Legend color={CAT_COLOR.mistake} label="Errore" />
              <Legend color={CAT_COLOR.blunder} label="Blunder" />
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function ResultBadge({ result }: { result: string | null }) {
  const color =
    result === "win" ? "text-green-300 bg-green-500/15 border-green-500/30" :
    result === "loss" ? "text-red-300 bg-red-500/15 border-red-500/30" :
    "text-slate-300 bg-slate-500/15 border-slate-500/30";
  const label = result === "win" ? "V" : result === "loss" ? "P" : "=";
  return (
    <span className={`ml-1 inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="min-h-full flex items-start justify-center p-4 lg:p-8">
        <div className="card w-full max-w-[1200px] relative">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 w-8 h-8 rounded-full border border-[color:var(--color-line)] hover:bg-slate-800 text-slate-300"
            aria-label="Chiudi"
          >
            ×
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}
