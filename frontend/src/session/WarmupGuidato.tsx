import { useEffect, useState } from "react";
import { Chess } from "chess.js";
import type { PositionRow } from "../types";
import { BoardView } from "../components/BoardView";
import { BoardLegend } from "../components/BoardLegend";
import { useStockfish, type EvalResult } from "../engine/useStockfish";
import { turnFromFen } from "../chess-utils";
import type { DrillVerdict } from "./store";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface WarmupGuidatoProps {
  position: PositionRow;
  patternLabel: string;
  onNext: () => void;
}

export interface DrillStepProps {
  position: PositionRow;
  patternLabel: string;
  onNext: () => void;
}

// ---------------------------------------------------------------------------
// Phrase banks
// ---------------------------------------------------------------------------

const WARMUP_INTROS = [
  "Muovi questo pezzo. Vediamo se trovi la mossa giusta.",
  "Ti aiuto: muovi questo. La casa di partenza è giusta. Trova dove.",
  "Da questa casa parte la mossa che salva. Sta a te trovare dove va.",
];

const DRILL_INTROS = [
  "Adesso senza aiuto. Trova tu la mossa.",
  "Senza suggerimenti questa volta. Pensa, poi muovi.",
  "Tutto su di te. Calma e attenzione.",
];

const VERDICT_PERFECT = [
  "Bravo. Hai trovato.",
  "Oooh. Esatta.",
  "Vista. Bene così.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBestFromSquare(fen: string, bestSan: string): string | null {
  try {
    const b = new Chess(fen);
    const mv = b.move(bestSan, { strict: false } as never);
    return mv ? mv.from : null;
  } catch {
    return null;
  }
}

function normalizeSan(san: string | null | undefined): string {
  if (!san) return "";
  return san.replace(/[+#!?]+$/g, "").trim();
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

function scoreFromMyPov(
  ev: EvalResult,
  iAmWhite: boolean,
  sideToMoveIsWhite: boolean,
): number {
  const raw =
    ev.scoreCp ?? (ev.mate != null ? (ev.mate > 0 ? 10000 : -10000) : 0);
  if (sideToMoveIsWhite === iAmWhite) return raw;
  return -raw;
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

// ---------------------------------------------------------------------------
// Shared internal component
// ---------------------------------------------------------------------------

export interface PositionPuzzleProps {
  position: PositionRow;
  patternLabel: string;
  withHint: boolean;
  introLines: string[];
  onNext: () => void;
  /** Callback opzionale chiamato quando il verdetto è deciso (perfect/ok/wrong). */
  onVerdict?: (v: DrillVerdict, ctx: { cpLoss: number; attempts: number; playedSan: string | null }) => void;
}

export function PositionPuzzle({
  position,
  patternLabel,
  withHint,
  introLines,
  onNext,
  onVerdict,
}: PositionPuzzleProps) {
  const sf = useStockfish();
  const [verdict, setVerdict] = useState<DrillVerdict | null>(null);
  const [cpLoss, setCpLoss] = useState<number | null>(null);
  const [playedSan, setPlayedSan] = useState<string | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [intro] = useState(() => pick(introLines));
  const [verdictMsg, setVerdictMsg] = useState<string>("");

  const baseFen = position.fen_before;
  const orientation = position.my_color || turnFromFen(baseFen);
  const puzzleKey = `${position.game_id}:${position.ply}`;

  // Reset on position change
  useEffect(() => {
    setVerdict(null);
    setCpLoss(null);
    setPlayedSan(null);
    setDisplayFen(null);
    setAttempts(0);
    setVerdictMsg("");
  }, [puzzleKey]);

  async function onDrop(from: string, to: string): Promise<boolean> {
    if (verdict !== null && verdict !== "wrong") return false;
    if (evaluating) return false;
    if (attempts >= 3) return false;

    const b = new Chess(baseFen);
    const mv = b.move({ from, to, promotion: "q" } as never);
    if (!mv) return false;

    const fenAfter = b.fen();
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    setPlayedSan(mv.san);
    setDisplayFen(fenAfter);
    setEvaluating(true);

    try {
      const evBefore: EvalResult = await sf.evaluate(baseFen, { depth: 14 });
      const evAfter: EvalResult = await sf.evaluate(fenAfter, { depth: 14 });
      const iAmWhite = orientation === "white";
      const cpBefore = scoreFromMyPov(
        evBefore,
        iAmWhite,
        "white" === sideToMove(baseFen),
      );
      const cpAfter = scoreFromMyPov(
        evAfter,
        iAmWhite,
        "white" === sideToMove(fenAfter),
      );
      const loss = Math.max(0, cpBefore - cpAfter);
      setCpLoss(loss);

      // Se SAN giocata == SAN best (normalizzati), forza "perfect" anche se
      // Stockfish a depth 14 calcola un cp_loss residuo per inconsistenza di
      // ricerca tra fen_before e fen_after.
      const playedMatchesBest =
        normalizeSan(mv.san) === normalizeSan(position.best_san_sf);

      if (playedMatchesBest || loss < 30) {
        setVerdict("perfect");
        setVerdictMsg(pick(VERDICT_PERFECT));
        onVerdict?.("perfect", { cpLoss: loss, attempts: newAttempts, playedSan: mv.san });
      } else if (loss < 100) {
        setVerdict("ok");
        const best = position.best_san_sf ?? "";
        setVerdictMsg(
          pick([
            `Giocabile. Ma c'era di meglio: ${best}.`,
            `Non sbagliato, però la mossa giusta era ${best}.`,
          ]),
        );
        onVerdict?.("ok", { cpLoss: loss, attempts: newAttempts, playedSan: mv.san });
      } else {
        // wrong
        if (newAttempts >= 2) {
          // after 2 failures → show solution, move on
          const best = position.best_san_sf ?? "";
          setVerdictMsg(
            `Hai sbagliato. La giusta era ${best}. Andiamo avanti.`,
          );
          setVerdict("wrong");
          onVerdict?.("wrong", { cpLoss: loss, attempts: newAttempts, playedSan: mv.san });
        } else {
          // allow retry
          setVerdictMsg("Mh. Non era quella. Riprova.");
          setVerdict(null); // keep puzzle open
          setDisplayFen(null); // reset board
          setPlayedSan(null);
        }
      }
    } finally {
      setEvaluating(false);
    }
    return true;
  }

  const showHints = verdict !== null;
  const playedSquares =
    playedSan && showHints ? sanToSquares(baseFen, playedSan) : null;
  const bestSquares =
    position.best_san_sf ? sanToSquares(baseFen, position.best_san_sf) : null;

  // Hint visuale: highlight casa di partenza della best_san_sf (solo warmup)
  const hintFrom =
    withHint && position.best_san_sf
      ? getBestFromSquare(baseFen, position.best_san_sf)
      : null;

  const highlights = [
    // Ultima mossa avversario (gialla, sempre)
    ...(position.last_opp_from && position.last_opp_to
      ? [
          { square: position.last_opp_from!, color: "#fde04755" },
          { square: position.last_opp_to!, color: "#fde04788" },
        ]
      : []),
    // Hint gold: casa di partenza della mossa giusta (solo WarmupGuidato)
    ...(hintFrom && verdict === null
      ? [{ square: hintFrom, color: "#f6c64a55" }]
      : []),
    // Verdict: mossa giocata
    ...(showHints && playedSquares
      ? [
          { square: playedSquares.from, color: verdictBg(verdict) },
          { square: playedSquares.to, color: verdictColor(verdict) },
        ]
      : []),
    // Verdict: mossa giusta (se diversa)
    ...(showHints && bestSquares && verdict !== "perfect"
      ? [
          { square: bestSquares.from, color: "#34d39955" },
          { square: bestSquares.to, color: "#34d399" },
        ]
      : []),
  ];

  const arrows = [
    ...(position.last_opp_from && position.last_opp_to
      ? [
          {
            from: position.last_opp_from!,
            to: position.last_opp_to!,
            color: "#fde047",
          },
        ]
      : []),
    ...(showHints && playedSquares
      ? [
          {
            from: playedSquares.from,
            to: playedSquares.to,
            color: verdictColor(verdict),
          },
        ]
      : []),
    ...(showHints && bestSquares && verdict !== "perfect"
      ? [{ from: bestSquares.from, to: bestSquares.to, color: "#34d399" }]
      : []),
  ];

  const color = verdictColor(verdict);

  return (
    <div className="position-puzzle grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">
      {/* Board + legenda */}
      <div className="flex flex-col items-center gap-2">
        <BoardView
          fen={displayFen || baseFen}
          resetKey={`${puzzleKey}:${attempts}`}
          orientation={orientation}
          size={460}
          draggable={!evaluating && (verdict === null || false)}
          onPieceDrop={onDrop}
          highlights={highlights}
          arrows={arrows}
        />
        <BoardLegend preset={verdict !== null ? "review" : (withHint ? "warmup" : "drill")} />
      </div>

      {/* Panel */}
      <div className="space-y-5">
        {/* Header */}
        <div>
          <div className="label-eyebrow">{patternLabel}</div>
          <h3 className="display-small mt-2">
            {orientation === "white" ? "Bianco" : "Nero"} muove
          </h3>
          <div className="text-sm text-[color:var(--color-text-soft)] mt-1">
            {position.date} · vs{" "}
            <span className="font-semibold tabular-nums">
              {position.opp_rating ?? "?"}
            </span>
            {position.opening && (
              <>
                {" "}
                · {position.opening}{" "}
                <span className="font-mono text-xs opacity-70">
                  ({position.eco})
                </span>
              </>
            )}
          </div>
        </div>

        {!sf.isReady && (
          <div className="pill pill-warn">Carico Stockfish…</div>
        )}

        {/* Intro / retry message */}
        {verdict === null && !evaluating && (
          <div
            className="position-puzzle-intro rounded-xl p-4 border"
            style={{
              background: "rgba(124,92,255,0.06)",
              borderColor: "rgba(124,92,255,0.25)",
            }}
          >
            <div className="text-sm leading-relaxed">
              {verdictMsg !== "" ? (
                <span className="text-[color:var(--color-gold-soft)] font-medium">
                  {verdictMsg}
                </span>
              ) : (
                <>
                  <b>Coach</b> — {intro}
                </>
              )}
            </div>
            {withHint && hintFrom && verdict === null && verdictMsg === "" && (
              <div className="mt-2 text-xs text-[color:var(--color-muted)]">
                Casa di partenza evidenziata in gold.
              </div>
            )}
          </div>
        )}

        {/* Evaluating */}
        {evaluating && (
          <div className="rounded-xl p-4 border border-[color:var(--color-line)] bg-white/[0.02]">
            <div className="text-sm text-[color:var(--color-text-soft)]">
              Stockfish sta valutando…
            </div>
          </div>
        )}

        {/* Verdict panel */}
        {verdict !== null && (
          <div
            className="position-puzzle-verdict rounded-xl p-5 border"
            style={{
              borderColor: `${color}55`,
              background: `${color}0d`,
            }}
          >
            <div className="display-small mb-3" style={{ color }}>
              {verdictMsg}
            </div>

            <div className="space-y-2 text-sm">
              {playedSan && (
                <div className="flex items-baseline gap-2">
                  <span className="label-eyebrow w-32">Hai giocato</span>
                  <span
                    className="font-mono font-semibold"
                    style={{ color }}
                  >
                    {playedSan}
                  </span>
                </div>
              )}
              {position.best_san_sf && position.best_san_sf !== playedSan && (
                <div className="flex items-baseline gap-2">
                  <span className="label-eyebrow w-32">Mossa giusta</span>
                  <span className="font-mono font-semibold text-[color:var(--color-ok)]">
                    {position.best_san_sf}
                  </span>
                </div>
              )}
              {cpLoss !== null && (
                <div className="flex items-baseline gap-2">
                  <span className="label-eyebrow w-32">Perdita</span>
                  <span className="font-mono text-xs text-[color:var(--color-text-soft)]">
                    {cpLoss > 0 ? `-${(cpLoss / 100).toFixed(2)}` : "0.00"} pedoni
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={onNext}
              className="btn btn-primary mt-4 w-full justify-center"
            >
              Avanti →
            </button>
          </div>
        )}

        {/* Attempts counter */}
        {attempts > 0 && verdict === null && (
          <div className="text-xs text-[color:var(--color-muted)]">
            Tentativo {attempts} / 3
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export function WarmupGuidato({ position, patternLabel, onNext }: WarmupGuidatoProps) {
  return (
    <div className="warmup-guidato">
      <PositionPuzzle
        position={position}
        patternLabel={patternLabel}
        withHint={true}
        introLines={WARMUP_INTROS}
        onNext={onNext}
      />
    </div>
  );
}

export function DrillStep({ position, patternLabel, onNext }: DrillStepProps) {
  return (
    <div className="drill-step">
      <PositionPuzzle
        position={position}
        patternLabel={patternLabel}
        withHint={false}
        introLines={DRILL_INTROS}
        onNext={onNext}
      />
    </div>
  );
}
