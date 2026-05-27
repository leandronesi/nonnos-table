import { useEffect, useState } from "react";
import { Chess } from "chess.js";
import type { PositionRow, CoachSession } from "../types";
import { BoardView } from "../components/BoardView";
import { CoachNote } from "../components/CoachNote";
import { useStockfish, type EvalResult } from "../engine/useStockfish";
import { cpToHuman, cpToPawns } from "../glossary";
import { turnFromFen } from "../chess-utils";
import type { DrillResult, DrillVerdict } from "./store";
import { maiaLabel, positionCoachLine, sessionFallbackLine } from "../coaching";

interface Props {
  drills: PositionRow[];                 // 5 posizioni pre-selezionate
  results: DrillResult[];                // risultati gia' fatti
  coachSession?: CoachSession;
  maiaLevel: number;
  onDrillDone: (r: DrillResult) => void;
  onAllDone: () => void;
}

/**
 * 5 posizioni in sequenza. Quando l'utente sbaglia o azzecca, si avanza
 * al prossimo dopo un breve "respiro" (no auto-skip immediato: gli serve
 * vedere la mossa giusta).
 */
export function WarmupStep({ drills, results, coachSession, maiaLevel, onDrillDone, onAllDone }: Props) {
  const sf = useStockfish();
  const [idx, setIdx] = useState(results.length);    // riprendi dove eri rimasto
  const [verdict, setVerdict] = useState<DrillVerdict | null>(null);
  const [cpLoss, setCpLoss] = useState<number | null>(null);
  const [playedSan, setPlayedSan] = useState<string | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [attempts, setAttempts] = useState(0);

  // quando cambio posizione, reset
  useEffect(() => {
    setVerdict(null);
    setCpLoss(null);
    setPlayedSan(null);
    setDisplayFen(null);
    setShowSolution(false);
    setAttempts(0);
  }, [idx]);

  if (idx >= drills.length) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="text-center mb-6">
          <div className="display-medium">Calcolo completato</div>
        </div>
        <CoachNote text={coachSession?.between_warmup_bivio || sessionFallbackLine("between_warmup_bivio", maiaLevel)} tone="warm" />
        <div className="text-center mt-6">
          <button onClick={onAllDone} className="btn btn-primary btn-lg">
            Vai ai bivi -&gt;
          </button>
        </div>
      </div>
    );
  }

  const d = drills[idx];
  const orientation = d.my_color || turnFromFen(d.fen_before);
  const baseFen = d.fen_before;
  const drillKey = `${d.game_id}:${d.ply}`;

  async function onDrop(from: string, to: string): Promise<boolean> {
    if (verdict !== null) return false;
    if (evaluating) return false;
    const b = new Chess(baseFen);
    const mv = b.move({ from, to, promotion: "q" } as never);
    if (!mv) return false;
    const fenAfter = b.fen();
    setPlayedSan(mv.san);
    setDisplayFen(fenAfter);
    setEvaluating(true);
    setAttempts((a) => a + 1);

    try {
      const evBefore: EvalResult = await sf.evaluate(baseFen, { depth: 14 });
      const evAfter: EvalResult = await sf.evaluate(fenAfter, { depth: 14 });
      const cpBefore = scoreFromMyPov(evBefore, orientation === "white", "white" === sideToMove(baseFen));
      const cpAfter = scoreFromMyPov(evAfter, orientation === "white", "white" === sideToMove(fenAfter));
      const loss = Math.max(0, cpBefore - cpAfter);
      setCpLoss(loss);
      const v: DrillVerdict = loss < 30 ? "perfect" : loss < 100 ? "ok" : "wrong";
      setVerdict(v);
    } finally {
      setEvaluating(false);
    }
    return true;
  }

  function commitAndNext() {
    if (verdict === null) return;
    onDrillDone({
      drillId: drillKey,
      verdict,
      cp_loss: cpLoss ?? 0,
      played_san: playedSan,
      attempts,
    });
    if (idx + 1 >= drills.length) onAllDone();
    else setIdx((i) => i + 1);
  }

  const showHints = verdict !== null || showSolution;
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
          resetKey={drillKey}
          orientation={orientation}
          size={460}
          draggable={verdict === null && !evaluating}
          onPieceDrop={onDrop}
          highlights={highlights}
          arrows={arrows}
        />
      </div>

      <div className="space-y-5">
        {idx === 0 && <CoachNote text={coachSession?.open_warmup || sessionFallbackLine("open_warmup", maiaLevel)} tone="warm" />}
        <CoachNote text={positionCoachLine(d, maiaLevel)} />

        <div>
          <div className="label-eyebrow">Posizione {idx + 1} di {drills.length}</div>
          <h3 className="display-small mt-2">
            {orientation === "white" ? "Bianco" : "Nero"} muove
          </h3>
          <div className="text-sm text-[color:var(--color-text-soft)] mt-1">
            {d.date}  -  vs <span className="font-semibold tabular-nums">{d.opp_rating ?? "?"}</span>
            {d.opening && <>  -  {d.opening} <span className="font-mono text-xs opacity-70">({d.eco})</span></>}
          </div>
        </div>

        {!sf.isReady && <div className="pill pill-warn">Preparo il tavolo di analisi...</div>}

        {verdict === null && !evaluating && !showSolution && (
          <div className="rounded-xl p-4 border" style={{ background: "rgba(124,92,255,0.06)", borderColor: "rgba(124,92,255,0.25)" }}>
            <div className="text-sm leading-relaxed">
              <b>Tocca a te.</b> Trascina il pezzo. La freccia gialla e' l'ultima mossa dell'avversario.
            </div>
            <div className="text-xs text-[color:var(--color-muted)] mt-2">
              La mossa giusta esce dopo il tuo tentativo.
            </div>
          </div>
        )}

        {evaluating && (
          <div className="rounded-xl p-4 border border-[color:var(--color-line)] bg-white/[0.02]">
            <div className="text-sm text-[color:var(--color-text-soft)]">Controllo varianti, catture e difensori...</div>
          </div>
        )}

        {verdict !== null && (
          <VerdictPanel
            verdict={verdict}
            cpLoss={cpLoss ?? 0}
            playedSan={playedSan}
            bestSan={d.best_san_sf}
            maiaSan={d.best_san_maia_target}
            maiaLevel={maiaLevel}
            pvSan={d.pv_san_sf}
            onNext={commitAndNext}
            isLast={idx + 1 >= drills.length}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function VerdictPanel({
  verdict,
  cpLoss,
  playedSan,
  bestSan,
  maiaSan,
  maiaLevel,
  pvSan,
  onNext,
  isLast,
}: {
  verdict: DrillVerdict;
  cpLoss: number;
  playedSan: string | null;
  bestSan: string | null;
  maiaSan: string | null;
  maiaLevel: number;
  pvSan: string | null;
  onNext: () => void;
  isLast: boolean;
}) {
  const tone = verdict === "perfect" ? "good" : verdict === "ok" ? "warn" : "bad";
  const title = verdict === "perfect" ? "Bravo  -  mossa esatta" : verdict === "ok" ? "Giocabile  -  c'era di piu'" : "Errore  -  ecco la giusta";
  const color = verdict === "perfect" ? "#34d399" : verdict === "ok" ? "#facc15" : "#f43f5e";

  return (
    <div className="rounded-xl p-5 border" style={{ borderColor: `${color}55`, background: `${color}0d` }}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="display-small" style={{ color }}>{title}</div>
        <span className={`pill pill-${tone}`}>{cpToPawns(-cpLoss)}  -  {cpToHuman(cpLoss)}</span>
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
            <span className="font-mono font-semibold text-[color:var(--color-ok)]">{bestSan}</span>
          </div>
        )}
        {maiaSan && maiaSan !== bestSan && (
          <div className="flex items-baseline gap-2">
            <span className="label-eyebrow w-32">{maiaLabel(maiaLevel)}</span>
            <span className="font-mono font-semibold text-[color:var(--color-gold-soft)]">{maiaSan}</span>
          </div>
        )}
        {pvSan && (
          <div className="flex items-baseline gap-2 pt-1">
            <span className="label-eyebrow w-32">Seguito</span>
            <span className="font-mono text-xs text-[color:var(--color-text-soft)]">{pvSan}</span>
          </div>
        )}
      </div>

      <button onClick={onNext} className="btn btn-primary mt-4 w-full justify-center">
        {isLast ? "Vai ai bivi ->" : "Prossima posizione ->"}
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
  // Score dal POV di chi muove. Se chi muove e' il mio colore, lo score e' gia' mio POV.
  // Se chi muove e' l'avversario, invertire.
  const fromMyPovIfSidesMatch = ev.scoreCp ?? (ev.mate != null ? (ev.mate > 0 ? 10000 : -10000) : 0);
  if (sideToMoveIsWhite === iAmWhite) return fromMyPovIfSidesMatch;
  return -fromMyPovIfSidesMatch;
}

function verdictColor(v: DrillVerdict | null): string {
  if (v === "perfect") return "#34d399";
  if (v === "ok") return "#facc15";
  if (v === "wrong") return "#f43f5e";
  return "#a18bff";
}

function verdictBg(v: DrillVerdict | null): string {
  return verdictColor(v) + "55";
}

