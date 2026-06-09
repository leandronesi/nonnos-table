/**
 * WarmupGuidato.tsx — PositionPuzzle (fase Aiuto + fase Da solo).
 *
 * Board-centrica, calma. Nonno presente in ogni stato.
 * Meccanismi anti-blunder SureCheck e "Ripensaci" INVARIATI.
 * Design migrato a sess-* + tt-* tokens (DESIGN.md compliant).
 *
 * Nota: WarmupGuidato e DrillStep sono wrapper pubblici di PositionPuzzle
 * (non usati direttamente da NonnoSession ma esportati per compat legacy).
 */

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { PositionRow } from "../types";
import { BoardView } from "../components/BoardView";
import { BoardLegend } from "../components/BoardLegend";
import { useBoardFit } from "../components/useBoardFit";
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
  "Ti aiuto: muovi questo. La casa di partenza e' giusta. Trova dove.",
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
  "Vista. Bene cosi.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS_IT = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"] as const;

function formatGameDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const day = d.getDate();
    const month = MONTHS_IT[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch { return ""; }
}

function getBestFromSquare(fen: string, bestSan: string): string | null {
  try {
    const b = new Chess(fen);
    const mv = b.move(bestSan, { strict: false } as never);
    return mv ? mv.from : null;
  } catch { return null; }
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
  } catch { return null; }
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
// PositionPuzzle — shared component (Aiuto + Da solo)
// ---------------------------------------------------------------------------

export interface PositionPuzzleProps {
  position: PositionRow;
  patternLabel: string;
  withHint: boolean;
  introLines: string[];
  onNext: () => void;
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
  const fit = useBoardFit({ min: 232, max: 460 });
  const [verdict, setVerdict] = useState<DrillVerdict | null>(null);
  const [, setCpLoss] = useState<number | null>(null);
  const [playedSan, setPlayedSan] = useState<string | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  // Ref-based guard: stato evaluating e' asincrono, ref e' sincrono
  const evaluatingRef = useRef(false);
  const [attempts, setAttempts] = useState(0);
  const [intro] = useState(() => pick(introLines));
  const [verdictMsg, setVerdictMsg] = useState<string>("");

  const baseFen = position.fen_before;
  const orientation = position.my_color || turnFromFen(baseFen);
  const puzzleKey = `${position.game_id}:${position.ply}`;

  useEffect(() => {
    setVerdict(null);
    setCpLoss(null);
    setPlayedSan(null);
    setDisplayFen(null);
    setAttempts(0);
    setVerdictMsg("");
    evaluatingRef.current = false;
  }, [puzzleKey]);

  async function onDrop(from: string, to: string): Promise<boolean> {
    if (verdict !== null && verdict !== "wrong") return false;
    if (evaluatingRef.current) return false;
    if (evaluating) return false;
    if (attempts >= 3) return false;

    const b = new Chess(baseFen);
    let mv: { from: string; to: string; san: string; lan: string } | null = null;
    try {
      mv = b.move({ from, to, promotion: "q" } as never);
    } catch { return false; }
    if (!mv) return false;

    evaluatingRef.current = true;

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
      const cpBefore = scoreFromMyPov(evBefore, iAmWhite, "white" === sideToMove(baseFen));
      const cpAfter  = scoreFromMyPov(evAfter, iAmWhite, "white" === sideToMove(fenAfter));
      const loss = Math.max(0, cpBefore - cpAfter);
      setCpLoss(loss);

      const playedMatchesBest =
        normalizeSan(mv.san) === normalizeSan(position.best_san_sf);

      if (playedMatchesBest || loss < 30) {
        setVerdict("perfect");
        setVerdictMsg(pick(VERDICT_PERFECT));
        onVerdict?.("perfect", { cpLoss: loss, attempts: newAttempts, playedSan: mv.san });
      } else if (loss < 100) {
        setVerdict("ok");
        const best = position.best_san_sf ?? "";
        setVerdictMsg(pick([
          `Giocabile. Ma c'era di meglio: ${best}.`,
          `Non sbagliato, pero' la mossa giusta era ${best}.`,
        ]));
        onVerdict?.("ok", { cpLoss: loss, attempts: newAttempts, playedSan: mv.san });
      } else {
        if (newAttempts >= 2) {
          const best = position.best_san_sf ?? "";
          setVerdictMsg(`Non era quella. La mossa era ${best}. Adesso la sai.`);
          setVerdict("wrong");
          onVerdict?.("wrong", { cpLoss: loss, attempts: newAttempts, playedSan: mv.san });
        } else {
          setVerdictMsg("Non era quella. Riprova.");
          setVerdict(null);
          setDisplayFen(null);
          setPlayedSan(null);
        }
      }
    } finally {
      evaluatingRef.current = false;
      setEvaluating(false);
    }
    return true;
  }

  const showHints = verdict !== null;
  const playedSquares =
    playedSan && showHints ? sanToSquares(baseFen, playedSan) : null;

  const bestSquares = (() => {
    if (position.best_san_sf) {
      const sq = sanToSquares(baseFen, position.best_san_sf);
      if (sq) return sq;
    }
    const uci = position.best_uci;
    if (uci && /^[a-h][1-8][a-h][1-8]/.test(uci)) {
      return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
    }
    return null;
  })();

  const hintFrom = (() => {
    if (!withHint) return null;
    if (position.best_san_sf) {
      const fromSan = getBestFromSquare(baseFen, position.best_san_sf);
      if (fromSan) return fromSan;
    }
    const uci = position.best_uci;
    if (uci && uci.length >= 4) {
      const sq = uci.slice(0, 2);
      if (/^[a-h][1-8]$/.test(sq)) return sq;
    }
    return null;
  })();

  const highlights = [
    ...(position.last_opp_from && position.last_opp_to
      ? [
          { square: position.last_opp_from!, color: "#fde04755" },
          { square: position.last_opp_to!, color: "#fde04788" },
        ]
      : []),
    ...(hintFrom && verdict === null
      ? [{ square: hintFrom, color: "#f6c64abb" }]
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
    ...(position.last_opp_from && position.last_opp_to
      ? [{ from: position.last_opp_from!, to: position.last_opp_to!, color: "#fde047" }]
      : []),
    ...(showHints && playedSquares
      ? [{ from: playedSquares.from, to: playedSquares.to, color: verdictColor(verdict) }]
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
        <div ref={fit.ref} className="sess-board-frame" style={{ width: "100%", maxWidth: fit.max }}>
          <BoardView
            fen={displayFen || baseFen}
            resetKey={`${puzzleKey}:${attempts}`}
            orientation={orientation}
            size={fit.size}
            draggable={!evaluating && (verdict === null || false)}
            onPieceDrop={onDrop}
            highlights={highlights}
            arrows={arrows}
          />
        </div>
        <BoardLegend
          items={(() => {
            const hasOpp = !!(position.last_opp_from && position.last_opp_to);
            if (verdict !== null) {
              return [
                ...(hasOpp ? [{ color: "#fde047", label: "ultima mossa avversario" }] : []),
                { color: "#f43f5e", label: "tua mossa" },
                { color: "#34d399", label: "mossa giusta" },
              ];
            }
            if (withHint) {
              return [
                ...(hasOpp ? [{ color: "#fde047", label: "ultima mossa avversario" }] : []),
                { color: "#f6c64abb", label: "casa di partenza (aiuto)" },
              ];
            }
            return hasOpp ? [{ color: "#fde047", label: "ultima mossa avversario" }] : [];
          })()}
        />
      </div>

      {/* Pannello */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* Header — tema + titolo + meta */}
        <div>
          <div className="tt-eyebrow" style={{ marginBottom: "0.4rem" }}>
            {patternLabel}
          </div>
          <h3 style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "1.25rem",
            color: "var(--color-text)",
            marginBottom: "0.25rem",
            letterSpacing: "-0.01em",
          }}>
            {orientation === "white" ? "Bianco" : "Nero"} muove
          </h3>
          <div className="sess-moment-meta">
            {formatGameDate(position.date) && (
              <span className="val">{formatGameDate(position.date)}</span>
            )}
            {position.opp_rating != null && (
              <>
                <span className="dot">·</span>
                <span className="val">vs {position.opp_rating}</span>
              </>
            )}
            {position.opening && (
              <>
                <span className="dot">·</span>
                <span className="it">{position.opening}</span>
              </>
            )}
          </div>
        </div>

        {/* Ultima mossa avversario */}
        {position.last_opp_san && (
          <div style={{
            padding: "0.625rem 0.875rem",
            borderRadius: "8px",
            background: "rgba(253,224,71,0.06)",
            border: "1px solid rgba(253,224,71,0.22)",
            display: "flex",
            alignItems: "baseline",
            gap: "0.5rem",
            fontSize: "0.875rem",
          }}>
            <span style={{ color: "var(--color-text-soft)" }}>
              L&apos;avversario ha appena giocato
            </span>
            <span
              className="mono"
              style={{ fontWeight: 700, color: "#fde047" }}
            >
              {position.last_opp_san}
            </span>
          </div>
        )}

        {!sf.isReady && (
          <div className="tt-chip" style={{ display: "inline-flex", alignSelf: "flex-start" }}>
            Carico motore…
          </div>
        )}

        {/* Voce Nonno — intro o messaggio retry */}
        {verdict === null && !evaluating && (
          <div className="sess-nonno">
            <span className="who">Nonno</span>
            <p>
              {verdictMsg !== ""
                ? <span style={{ color: "var(--color-gold-soft)" }}>{verdictMsg}</span>
                : intro}
            </p>
            {withHint && hintFrom && verdictMsg === "" && (
              <p style={{ marginTop: "6px", fontSize: "0.82rem", color: "var(--color-text-soft)", fontFamily: "var(--font-sans)", fontWeight: 400 }}>
                La casa di partenza e&apos; evidenziata in oro sulla scacchiera.
              </p>
            )}
          </div>
        )}

        {/* Valutazione in corso */}
        {evaluating && (
          <div style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            border: "1px solid var(--color-line)",
            background: "rgba(255,255,255,0.02)",
            fontSize: "0.875rem",
            color: "var(--color-muted)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}>
            <span style={{
              width: "0.45rem",
              height: "0.45rem",
              borderRadius: "999px",
              background: "var(--color-brand-soft)",
              flexShrink: 0,
              animation: "pulseGlow 1.4s ease-in-out infinite",
            }} />
            Guardo la mossa…
          </div>
        )}

        {/* Verdetto */}
        {verdict !== null && (
          <div
            className="sess-verdict"
            style={{
              border: `1px solid ${color}44`,
              background: `${color}09`,
            }}
          >
            {/* Messaggio principale */}
            <div style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "1.2rem",
              lineHeight: 1.25,
              color,
            }}>
              {verdictMsg}
            </div>

            {/* Dettagli mossa */}
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              paddingBottom: "12px",
              borderBottom: "1px solid var(--color-line)",
            }}>
              {playedSan && (
                <div className="sess-move-row">
                  <span className="lbl">Hai giocato</span>
                  <span className="san" style={{ color }}>{playedSan}</span>
                </div>
              )}
              {position.best_san_sf && position.best_san_sf !== playedSan && (
                <div className="sess-move-row">
                  <span className="lbl">Mossa giusta</span>
                  <span className="san" style={{ color: "var(--color-ok)" }}>
                    {position.best_san_sf}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={onNext}
              className="btn btn-primary btn-lg"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Avanti
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public exports (compat legacy)
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
