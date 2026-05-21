import { useEffect, useState } from "react";
import { Chess } from "chess.js";
import type { PositionRow } from "../types";
import { BoardView } from "../components/BoardView";
import { useStockfish, type EvalResult } from "../engine/useStockfish";
import { cpToHuman, cpToPawns } from "../glossary";
import { turnFromFen } from "../chess-utils";
import type { BivioResult } from "./store";

interface Props {
  tps: PositionRow[];
  results: BivioResult[];
  onBivioDone: (r: BivioResult) => void;
  onAllDone: () => void;
}

type Verdict = "perfect" | "ok" | "wrong" | null;

/**
 * Bivi = posizioni che hanno deciso le partite, non strettamente blunder evitabili.
 * Stessa UX del warmup (drag&drop + Stockfish judge), ma con il messaging diverso:
 * "Cosa avresti dovuto giocare?".
 */
export function BivioStep({ tps, results, onBivioDone, onAllDone }: Props) {
  const sf = useStockfish();
  const [idx, setIdx] = useState(results.length);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [cpLoss, setCpLoss] = useState<number | null>(null);
  const [playedSan, setPlayedSan] = useState<string | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setVerdict(null);
    setCpLoss(null);
    setPlayedSan(null);
    setDisplayFen(null);
    setRevealed(false);
  }, [idx]);

  if (idx >= tps.length) {
    return (
      <div className="text-center py-20">
        <div className="display-medium">Bivi visti</div>
        <button onClick={onAllDone} className="btn btn-primary btn-lg mt-6">
          Alla partita →
        </button>
      </div>
    );
  }

  const d = tps[idx];
  const orientation = d.my_color || turnFromFen(d.fen_before);
  const baseFen = d.fen_before;
  const bivioKey = `${d.game_id}:${d.ply}`;

  async function onDrop(from: string, to: string): Promise<boolean> {
    if (verdict !== null || revealed) return false;
    if (evaluating) return false;
    const b = new Chess(baseFen);
    const mv = b.move({ from, to, promotion: "q" } as never);
    if (!mv) return false;
    const fenAfter = b.fen();
    setPlayedSan(mv.san);
    setDisplayFen(fenAfter);
    setEvaluating(true);

    try {
      const evBefore: EvalResult = await sf.evaluate(baseFen, { depth: 14 });
      const evAfter: EvalResult = await sf.evaluate(fenAfter, { depth: 14 });
      const cpBefore = scoreFromMyPov(evBefore, orientation === "white", "white" === sideToMove(baseFen));
      const cpAfter = scoreFromMyPov(evAfter, orientation === "white", "white" === sideToMove(fenAfter));
      const loss = Math.max(0, cpBefore - cpAfter);
      setCpLoss(loss);
      const v: Verdict = loss < 30 ? "perfect" : loss < 100 ? "ok" : "wrong";
      setVerdict(v);
    } finally {
      setEvaluating(false);
    }
    return true;
  }

  function commitAndNext() {
    onBivioDone({ tpId: bivioKey, revealed: true });
    if (idx + 1 >= tps.length) onAllDone();
    else setIdx((i) => i + 1);
  }

  function revealSkip() {
    setRevealed(true);
    setVerdict("wrong");
    setPlayedSan(d.san);
    setCpLoss(d.cp_loss);
  }

  const showHints = verdict !== null || revealed;
  const playedSquares = playedSan ? sanToSquares(baseFen, playedSan) : null;
  const bestSquares = d.best_san_sf ? sanToSquares(baseFen, d.best_san_sf) : null;

  const highlights = [
    ...(d.last_opp_from && d.last_opp_to
      ? [
          { square: d.last_opp_from!, color: "#fde04755" },
          { square: d.last_opp_to!, color: "#fde04788" },
        ]
      : []),
    ...(showHints && playedSquares
      ? [
          { square: playedSquares.from, color: verdictBg(verdict) },
          { square: playedSquares.to, color: verdictColor(verdict) },
        ]
      : []),
    ...(showHints && bestSquares && verdict !== "perfect"
      ? [
          { square: bestSquares.from, color: "#34d39955" },
          { square: bestSquares.to, color: "#34d399" },
        ]
      : []),
  ];

  const arrows = [
    ...(d.last_opp_from && d.last_opp_to ? [{ from: d.last_opp_from!, to: d.last_opp_to!, color: "#fde047" }] : []),
    ...(showHints && playedSquares ? [{ from: playedSquares.from, to: playedSquares.to, color: verdictColor(verdict) }] : []),
    ...(showHints && bestSquares && verdict !== "perfect" ? [{ from: bestSquares.from, to: bestSquares.to, color: "#34d399" }] : []),
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">
      <div className="flex justify-center">
        <BoardView
          fen={displayFen || baseFen}
          resetKey={bivioKey}
          orientation={orientation}
          size={460}
          draggable={verdict === null && !revealed && !evaluating}
          onPieceDrop={onDrop}
          highlights={highlights}
          arrows={arrows}
        />
      </div>

      <div className="space-y-5">
        <div>
          <div className="label-eyebrow">Bivio {idx + 1} di {tps.length}</div>
          <h3 className="display-small mt-2">
            {orientation === "white" ? "Bianco" : "Nero"} muove · quale mossa?
          </h3>
          <div className="text-sm text-[color:var(--color-text-soft)] mt-1">
            Una delle 3 posizioni che hanno deciso davvero quella partita.{" "}
            {d.date} · vs <span className="font-semibold tabular-nums">{d.opp_rating ?? "?"}</span>
            {d.opening && <> · {d.opening} <span className="font-mono text-xs opacity-70">({d.eco})</span></>}
          </div>
        </div>

        {!sf.isReady && <div className="pill pill-warn">Carico Stockfish…</div>}

        {verdict === null && !revealed && !evaluating && (
          <div className="rounded-xl p-4 border" style={{ background: "rgba(124,92,255,0.06)", borderColor: "rgba(124,92,255,0.25)" }}>
            <div className="text-sm leading-relaxed">
              <b>Tocca a te.</b> Trascina il pezzo che giocheresti. La freccia gialla è
              l'ultima mossa dell'avversario.
            </div>
            <button onClick={revealSkip} className="btn btn-ghost btn-sm mt-3">
              Non lo so · mostra soluzione
            </button>
          </div>
        )}

        {evaluating && (
          <div className="rounded-xl p-4 border border-[color:var(--color-line)] bg-white/[0.02]">
            <div className="text-sm text-[color:var(--color-text-soft)]">Stockfish sta valutando…</div>
          </div>
        )}

        {(verdict !== null || revealed) && (
          <VerdictPanel
            verdict={verdict}
            cpLoss={cpLoss ?? d.cp_loss}
            playedSan={playedSan}
            bestSan={d.best_san_sf}
            pvSan={d.pv_san_sf}
            motif={d.motif_label_it}
            onNext={commitAndNext}
            isLast={idx + 1 >= tps.length}
          />
        )}
      </div>
    </div>
  );
}

function VerdictPanel({
  verdict,
  cpLoss,
  playedSan,
  bestSan,
  pvSan,
  motif,
  onNext,
  isLast,
}: {
  verdict: Verdict;
  cpLoss: number;
  playedSan: string | null;
  bestSan: string | null;
  pvSan: string | null;
  motif: string | null;
  onNext: () => void;
  isLast: boolean;
}) {
  const title =
    verdict === "perfect" ? "Bravo · mossa esatta" :
    verdict === "ok" ? "Giocabile · c'era meglio" :
    "Ecco la mossa giusta";
  const color = verdict === "perfect" ? "#34d399" : verdict === "ok" ? "#facc15" : "#f43f5e";

  return (
    <div className="rounded-xl p-5 border" style={{ borderColor: `${color}55`, background: `${color}0d` }}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="display-small" style={{ color }}>{title}</div>
        {cpLoss > 0 && (
          <span className={`pill pill-${verdict === "perfect" ? "good" : verdict === "ok" ? "warn" : "bad"}`}>
            {cpToPawns(-cpLoss)} · {cpToHuman(cpLoss)}
          </span>
        )}
      </div>

      <div className="space-y-2 text-sm">
        {playedSan && (
          <div className="flex items-baseline gap-2">
            <span className="label-eyebrow w-32">Hai giocato</span>
            <span className="font-mono font-semibold" style={{ color }}>{playedSan}</span>
          </div>
        )}
        {bestSan && bestSan !== playedSan && (
          <div className="flex items-baseline gap-2">
            <span className="label-eyebrow w-32">Mossa giusta</span>
            <span className="font-mono font-semibold text-emerald-300">{bestSan}</span>
          </div>
        )}
        {pvSan && (
          <div className="flex items-baseline gap-2">
            <span className="label-eyebrow w-32">Seguito</span>
            <span className="font-mono text-xs text-[color:var(--color-text-soft)]">{pvSan}</span>
          </div>
        )}
        {motif && (
          <div className="flex items-baseline gap-2">
            <span className="label-eyebrow w-32">Tema</span>
            <span className="font-mono text-xs">{motif}</span>
          </div>
        )}
      </div>

      <button onClick={onNext} className="btn btn-primary mt-4 w-full justify-center">
        {isLast ? "Alla partita →" : "Prossimo bivio →"}
      </button>
    </div>
  );
}

function sanToSquares(fen: string, san: string): { from: string; to: string } | null {
  try {
    const c = new Chess(fen);
    const mv = c.move(san, { strict: false } as never);
    if (!mv) return null;
    return { from: mv.from, to: mv.to };
  } catch {
    return null;
  }
}

function sideToMove(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function scoreFromMyPov(ev: EvalResult, iAmWhite: boolean, sideToMoveIsWhite: boolean): number {
  const fromMyPovIfSidesMatch = ev.scoreCp ?? (ev.mate != null ? (ev.mate > 0 ? 10000 : -10000) : 0);
  if (sideToMoveIsWhite === iAmWhite) return fromMyPovIfSidesMatch;
  return -fromMyPovIfSidesMatch;
}

function verdictColor(v: Verdict): string {
  if (v === "perfect") return "#34d399";
  if (v === "ok") return "#facc15";
  if (v === "wrong") return "#f43f5e";
  return "#a18bff";
}

function verdictBg(v: Verdict): string {
  return verdictColor(v) + "55";
}
