/**
 * CaduteTrainer — trainer graduato 3 fasi su un gruppo di cadute (per motif/ancora).
 *
 * Fase 1 GUARDA: carosello statico, freccia avversario + freccia mossa giusta + riga Nonno.
 * Fase 2 CON L'AVVERSARIO: mostra mossa avversario, nascondi quella giusta; utente muove.
 * Fase 3 DA SOLO (cieco): nessun contesto avversario; utente muove.
 *
 * Valutazione Stockfish (cp_loss):
 *   perfetta (best o cp_loss ~ 0)  -> "Si'!"
 *   abbastanza buona (cp_loss < 50) -> avvertito ("buona, ma c'era di meglio: X")
 *   sbagliata (cp_loss >= 50)       -> fatto notare ("no: era X")
 *
 * Gestisce 1-2 posizioni con grazia (salta fasi che non hanno senso).
 * Non blocca se Stockfish tarda (timeout 12s, poi skip con messaggio).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Chess } from "chess.js";
import type { PositionExample } from "../pipeline/aggregate";
import { BoardView } from "../components/BoardView";
import { BoardLegend } from "../components/BoardLegend";
import { useBoardFit } from "../components/useBoardFit";
import { useStockfish } from "../engine/useStockfish";
import { uciToArrow, uciToSan } from "../pages/quaderno/boardArrows";

// ────────────────────────────────────────────────────────────────────────────
// Types & constants
// ────────────────────────────────────────────────────────────────────────────

type TrainerPhase = "guarda" | "con_avversario" | "da_solo" | "done";

interface PhaseResult {
  verdict: "perfect" | "good" | "wrong" | "skipped";
  cpLoss: number | null;
  playedSan: string | null;
}

type MoveResult = "perfect" | "good" | "wrong";

// Soglie cp_loss per la valutazione (spec §6.6)
const CP_PERFECT_THRESHOLD = 30;   // praticamente la mossa migliore
const CP_GOOD_THRESHOLD    = 50;   // abbastanza buona

// Frasi Nonno per la valutazione
const VERDICT_LINES: Record<MoveResult, string[]> = {
  perfect: [
    "Si'. Vista.",
    "Bravo. Hai trovato.",
    "Esatta. Bene cosi'.",
  ],
  good: [],   // generato dinamicamente con la mossa migliore
  wrong: [],  // generato dinamicamente
};

function pickVerdict(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function sideToMove(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

const MONTHS_IT = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"] as const;
function dateIt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return ""; }
}

/** Build Nonno's one-liner for GUARDA phase given the position */
function buildGuardaLine(pos: PositionExample): string {
  const bestSan = uciToSan(pos.fen_before, pos.best_uci ?? null);
  const oppCtx = pos.last_opp_san
    ? `Dopo ${pos.last_opp_san}, la mossa giusta era ${bestSan}.`
    : `La mossa giusta era ${bestSan}.`;

  if (pos.cp_loss > 200) {
    return `${oppCtx} Riconosci il pattern.`;
  } else if (pos.cp_loss > 80) {
    return `${oppCtx} Era evitabile.`;
  } else {
    return `${oppCtx} Una piccola imprecisione, ma si ripete.`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Phase indicators component
// ────────────────────────────────────────────────────────────────────────────

function PhaseIndicator({ phase, totalPositions }: { phase: TrainerPhase; totalPositions: number }) {
  const phases: { key: TrainerPhase; label: string }[] = [
    { key: "guarda",          label: "Guarda"         },
    { key: "con_avversario",  label: "Con avversario" },
    { key: "da_solo",         label: "Da solo"        },
  ];
  if (totalPositions < 2) {
    return null;
  }
  return (
    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap" }}>
      {phases.map((p, i) => {
        const isActive = p.key === phase;
        const isDone =
          (i === 0 && (phase === "con_avversario" || phase === "da_solo" || phase === "done")) ||
          (i === 1 && (phase === "da_solo" || phase === "done")) ||
          (i === 2 && phase === "done");
        return (
          <div key={p.key} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {i > 0 && (
              <div style={{ width: "1.5rem", height: "1px", background: "var(--color-line-strong)" }} />
            )}
            <div style={{
              display: "flex", alignItems: "center", gap: "0.4rem",
              padding: "0.3rem 0.7rem",
              borderRadius: "999px",
              border: `1px solid ${isActive ? "var(--color-brand)" : isDone ? "var(--color-ok)" : "var(--color-line)"}`,
              background: isActive
                ? "color-mix(in srgb, var(--color-brand) 12%, transparent)"
                : isDone
                  ? "color-mix(in srgb, var(--color-ok) 8%, transparent)"
                  : "transparent",
              fontSize: "0.72rem",
              fontWeight: isActive ? 700 : 500,
              color: isActive
                ? "var(--color-brand-soft)"
                : isDone
                  ? "var(--color-ok)"
                  : "var(--color-faint)",
              transition: "all 200ms",
            }}>
              {isDone && <span>✓</span>}
              <span>{i + 1}. {p.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 1: GUARDA (carosello statico)
// ────────────────────────────────────────────────────────────────────────────

function PhaseGuarda({
  positions,
  groupLabel,
  onNext,
}: {
  positions: PositionExample[];
  groupLabel: string;
  onNext: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const fit = useBoardFit({ min: 232, max: 380 });
  const pos = positions[idx];
  if (!pos) return null;

  const oppArrow   = uciToArrow(pos.last_opp_from && pos.last_opp_to
    ? `${pos.last_opp_from}${pos.last_opp_to}` : null, "#fde047");
  const bestArrow  = uciToArrow(pos.best_uci ?? null, "#34d399");
  const arrows = [oppArrow, bestArrow].filter(Boolean) as { from: string; to: string; color: string }[];

  const orientation = pos.color === "black" ? "black" : "white";
  const bestSan = uciToSan(pos.fen_before, pos.best_uci ?? null);
  const nonnoLine = buildGuardaLine(pos);

  return (
    <div>
      <div className="tt-eyebrow" style={{ marginBottom: "0.5rem", color: "var(--color-muted)" }}>
        Fase 1 · Guarda — {groupLabel}
      </div>
      <p className="tt-nonno" style={{ marginBottom: "1.5rem" }}>
        Guarda le frecce. La verde e' la mossa giusta, la gialla e' la mossa dell'avversario.
        Costruisci il riconoscimento.
      </p>

      {/* key={idx} re-mounts → phase-enter animation fires on each carousel step */}
      <div key={idx} className="trainer-phase-layout phase-enter">
        {/* Board */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "center" }}>
          <div ref={fit.ref} style={{ width: "100%", maxWidth: fit.max }}>
            <BoardView
              fen={pos.fen_before}
              resetKey={`guarda:${idx}:${pos.fen_before}`}
              orientation={orientation}
              size={fit.size}
              draggable={false}
              arrows={arrows}
            />
          </div>
          <BoardLegend items={[
            ...(oppArrow ? [{ color: "#fde047", label: "mossa avversario" }] : []),
            { color: "#34d399", label: "mossa giusta" },
          ]} />
        </div>

        {/* Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="tt-eyebrow" style={{ color: "var(--color-muted)" }}>
            {idx + 1} / {positions.length}
            {dateIt(pos.played_at) && ` · ${dateIt(pos.played_at)}`}
          </div>

          {/* Avversario */}
          {pos.last_opp_san && (
            <div style={{
              padding: "0.625rem 0.875rem", borderRadius: "8px",
              background: "rgba(253,224,71,0.06)", border: "1px solid rgba(253,224,71,0.22)",
              display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.875rem",
            }}>
              <span style={{ color: "var(--color-text-soft)" }}>L'avversario ha giocato</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "#fde047" }}>
                {pos.last_opp_san}
              </span>
            </div>
          )}

          {/* Mossa giusta */}
          <div style={{
            padding: "0.625rem 0.875rem", borderRadius: "8px",
            background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.22)",
            display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.875rem",
          }}>
            <span style={{ color: "var(--color-text-soft)" }}>Mossa giusta</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "#34d399" }}>
              {bestSan}
            </span>
          </div>

          {/* Nonno line */}
          <div style={{
            padding: "0.75rem 1rem", borderRadius: "8px",
            background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-line)",
            fontSize: "0.88rem", color: "var(--color-text-soft)", lineHeight: 1.65,
          }}>
            <span style={{ fontWeight: 600, color: "var(--color-brand-soft)", fontSize: "0.75rem", display: "block", marginBottom: "0.25rem" }}>
              Nonno
            </span>
            {nonnoLine}
          </div>

          {/* Nav */}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            {idx > 0 && (
              <button
                onClick={() => setIdx(idx - 1)}
                className="btn btn-ghost btn-sm"
                style={{ flex: "0 0 auto" }}
              >
                Indietro
              </button>
            )}
            {idx < positions.length - 1 ? (
              <button
                onClick={() => setIdx(idx + 1)}
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
              >
                Prossima posizione
              </button>
            ) : (
              <button
                onClick={onNext}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                Allena con l'avversario
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 & 3: interactive puzzle (con avversario / da solo)
// ────────────────────────────────────────────────────────────────────────────

interface InteractivePuzzleProps {
  pos: PositionExample;
  showOpponent: boolean;  // fase 2 = true, fase 3 = false
  posIndex: number;
  posTotal: number;
  phaseLabel: string;
  onNext: (result: PhaseResult) => void;
}

function InteractivePuzzle({
  pos,
  showOpponent,
  posIndex,
  posTotal,
  phaseLabel,
  onNext,
}: InteractivePuzzleProps) {
  const sf = useStockfish();
  const fit = useBoardFit({ min: 232, max: 380 });
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const evaluatingRef = useRef(false);
  const [verdict, setVerdict] = useState<"perfect" | "good" | "wrong" | null>(null);
  const [verdictMsg, setVerdictMsg] = useState<string>("");
  const [cpLoss, setCpLoss] = useState<number | null>(null);
  const [playedSan, setPlayedSan] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const baseFen = pos.fen_before;
  const orientation = pos.color === "black" ? "black" : "white";
  const bestSan = uciToSan(pos.fen_before, pos.best_uci ?? null);
  const puzzleKey = `${posIndex}:${pos.fen_before}:${showOpponent ? "opp" : "solo"}`;

  useEffect(() => {
    setDisplayFen(null);
    setEvaluating(false);
    evaluatingRef.current = false;
    setVerdict(null);
    setVerdictMsg("");
    setCpLoss(null);
    setPlayedSan(null);
    setAttempts(0);
  }, [puzzleKey]);

  const onDrop = useCallback(async (from: string, to: string): Promise<boolean> => {
    if (verdict !== null && verdict !== "wrong") return false;
    if (evaluatingRef.current) return false;
    if (attempts >= 2) return false;

    const b = new Chess(baseFen);
    let mv: { from: string; to: string; san: string } | null = null;
    try {
      mv = b.move({ from, to, promotion: "q" } as never);
    } catch { return false; }
    if (!mv) return false;

    evaluatingRef.current = true;
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    setPlayedSan(mv.san);
    setDisplayFen(b.fen());
    setEvaluating(true);

    try {
      const [evBefore, evAfter] = await Promise.all([
        sf.evaluate(baseFen, { depth: 12, movetimeMs: 3000 }),
        sf.evaluate(b.fen(), { depth: 12, movetimeMs: 3000 }),
      ]);

      const iAmWhite = orientation === "white";
      const stmBefore = sideToMove(baseFen) === "white";
      const stmAfter  = sideToMove(b.fen()) === "white";

      const cpBefore = (() => {
        const raw = evBefore.scoreCp ?? (evBefore.mate != null ? (evBefore.mate > 0 ? 10000 : -10000) : 0);
        return stmBefore === iAmWhite ? raw : -raw;
      })();
      const cpAfter = (() => {
        const raw = evAfter.scoreCp ?? (evAfter.mate != null ? (evAfter.mate > 0 ? 10000 : -10000) : 0);
        return stmAfter === iAmWhite ? raw : -raw;
      })();
      const loss = Math.max(0, cpBefore - cpAfter);
      setCpLoss(loss);

      const playedMatchesBest =
        mv.san.replace(/[+#!?]+$/, "").trim() === bestSan.replace(/[+#!?]+$/, "").trim();

      if (playedMatchesBest || loss < CP_PERFECT_THRESHOLD) {
        setVerdict("perfect");
        setVerdictMsg(pickVerdict(VERDICT_LINES.perfect));
      } else if (loss < CP_GOOD_THRESHOLD) {
        setVerdict("good");
        setVerdictMsg(`Buona, ma c'era di meglio: ${bestSan}.`);
      } else {
        if (newAttempts >= 2) {
          setVerdict("wrong");
          setVerdictMsg(`No: era ${bestSan}. Andiamo avanti.`);
        } else {
          setVerdictMsg("Non era quella. Riprova.");
          setVerdict(null);
          setDisplayFen(null);
          setPlayedSan(null);
        }
      }
    } catch {
      // Stockfish timeout or error — skip gracefully
      setVerdict("wrong");
      setVerdictMsg(`Il motore non ha risposto. La mossa giusta era ${bestSan}.`);
      setCpLoss(null);
    } finally {
      evaluatingRef.current = false;
      setEvaluating(false);
    }
    return true;
  }, [baseFen, attempts, verdict, orientation, bestSan, sf, puzzleKey]);

  const verdictColor = verdict === "perfect"
    ? "#34d399" : verdict === "good"
      ? "#facc15" : verdict === "wrong"
        ? "#f43f5e" : "#a18bff";

  // Arrows
  const oppArrow = showOpponent && pos.last_opp_from && pos.last_opp_to
    ? uciToArrow(`${pos.last_opp_from}${pos.last_opp_to}`, "#fde047")
    : null;

  const playedSquares = (() => {
    if (!playedSan || verdict === null) return null;
    try {
      const c = new Chess(baseFen);
      const mv = c.move(playedSan, { strict: false } as never);
      return mv ? { from: mv.from, to: mv.to } : null;
    } catch { return null; }
  })();

  const bestSquares = (() => {
    if (pos.best_uci && pos.best_uci.length >= 4) {
      return { from: pos.best_uci.slice(0, 2), to: pos.best_uci.slice(2, 4) };
    }
    return null;
  })();

  const arrows = [
    ...(oppArrow ? [oppArrow] : []),
    ...(verdict !== null && playedSquares
      ? [{ from: playedSquares.from, to: playedSquares.to, color: verdictColor }]
      : []),
    ...(verdict !== null && bestSquares && verdict !== "perfect"
      ? [{ from: bestSquares.from, to: bestSquares.to, color: "#34d399" }]
      : []),
  ];

  const highlights = [
    ...(showOpponent && pos.last_opp_from && pos.last_opp_to
      ? [
          { square: pos.last_opp_from, color: "#fde04755" },
          { square: pos.last_opp_to,   color: "#fde04788" },
        ]
      : []),
    ...(verdict !== null && playedSquares
      ? [
          { square: playedSquares.from, color: verdictColor + "55" },
          { square: playedSquares.to,   color: verdictColor },
        ]
      : []),
    ...(verdict !== null && bestSquares && verdict !== "perfect"
      ? [
          { square: bestSquares.from, color: "#34d39955" },
          { square: bestSquares.to,   color: "#34d399" },
        ]
      : []),
  ];

  const phaseResult: PhaseResult = {
    verdict: verdict ?? "skipped",
    cpLoss,
    playedSan,
  };

  return (
    <div key={puzzleKey} className="phase-enter">
      <div className="tt-eyebrow" style={{ marginBottom: "0.5rem", color: "var(--color-muted)" }}>
        {phaseLabel} · {posIndex + 1} / {posTotal}
      </div>

      <div className="trainer-phase-layout">
        {/* Board */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "center" }}>
          <div ref={fit.ref} style={{ width: "100%", maxWidth: fit.max }}>
            <BoardView
              fen={displayFen ?? baseFen}
              resetKey={`${puzzleKey}:${attempts}`}
              orientation={orientation}
              size={fit.size}
              draggable={!evaluating && (verdict === null || verdict === "wrong")}
              onPieceDrop={onDrop}
              arrows={arrows}
              highlights={highlights}
            />
          </div>
          <BoardLegend items={(() => {
            if (verdict !== null) return [
              ...(oppArrow ? [{ color: "#fde047", label: "mossa avversario" }] : []),
              { color: verdictColor, label: "tua mossa" },
              ...(verdict !== "perfect" ? [{ color: "#34d399", label: "mossa giusta" }] : []),
            ];
            return [
              ...(oppArrow ? [{ color: "#fde047", label: "mossa avversario" }] : []),
            ];
          })()} />
        </div>

        {/* Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Avversario (fase 2) */}
          {showOpponent && pos.last_opp_san && (
            <div style={{
              padding: "0.625rem 0.875rem", borderRadius: "8px",
              background: "rgba(253,224,71,0.06)", border: "1px solid rgba(253,224,71,0.22)",
              display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.875rem",
            }}>
              <span style={{ color: "var(--color-text-soft)" }}>L'avversario ha appena giocato</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "#fde047" }}>
                {pos.last_opp_san}
              </span>
            </div>
          )}

          {/* Nonno — intro o retry */}
          {!evaluating && verdict === null && (
            <div style={{
              padding: "0.75rem 1rem", borderRadius: "8px",
              background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-line)",
              fontSize: "0.88rem", lineHeight: 1.65,
            }}>
              <span style={{ fontWeight: 600, color: "var(--color-brand-soft)", fontSize: "0.75rem", display: "block", marginBottom: "0.25rem" }}>
                Nonno
              </span>
              <span style={{ color: "var(--color-text-soft)" }}>
                {verdictMsg !== "" ? (
                  <span style={{ color: "var(--color-gold-soft)" }}>{verdictMsg}</span>
                ) : showOpponent
                  ? "L'avversario si e' mosso. Rispondi tu."
                  : "Nessun contesto. Trova tu la mossa migliore."
                }
              </span>
            </div>
          )}

          {/* Engine busy */}
          {evaluating && (
            <div style={{
              padding: "0.75rem 1rem", borderRadius: "8px",
              border: "1px solid var(--color-line)", background: "rgba(255,255,255,0.02)",
              fontSize: "0.875rem", color: "var(--color-muted)", display: "flex", alignItems: "center", gap: "0.5rem",
            }}>
              <span style={{
                width: "0.45rem", height: "0.45rem", borderRadius: "999px",
                background: "var(--color-brand-soft)", flexShrink: 0,
                animation: "pulseGlow 1.4s ease-in-out infinite",
              }} />
              Stockfish valuta...
            </div>
          )}

          {/* Verdetto */}
          {verdict !== null && (
            <div style={{
              padding: "1rem 1.125rem", borderRadius: "10px",
              border: `1px solid ${verdictColor}44`,
              background: `${verdictColor}09`,
              display: "flex", flexDirection: "column", gap: "0.875rem",
            }}>
              <div style={{
                fontFamily: "var(--font-display)", fontWeight: 600,
                fontSize: "1.1rem", lineHeight: 1.25, color: verdictColor,
              }}>
                {verdictMsg}
              </div>
              {/* Move details */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", paddingBottom: "0.875rem", borderBottom: "1px solid var(--color-line)" }}>
                {playedSan && (
                  <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.82rem" }}>
                    <span style={{ color: "var(--color-muted)", width: "7rem" }}>Hai giocato</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: verdictColor }}>{playedSan}</span>
                  </div>
                )}
                {verdict !== "perfect" && (
                  <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.82rem" }}>
                    <span style={{ color: "var(--color-muted)", width: "7rem" }}>Mossa giusta</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "#34d399" }}>{bestSan}</span>
                  </div>
                )}
              </div>
              <button onClick={() => onNext(phaseResult)} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                Avanti
              </button>
            </div>
          )}

          {/* Engine not ready notice */}
          {!sf.isReady && verdict === null && (
            <div className="tt-chip" style={{ display: "inline-flex", alignSelf: "flex-start", color: "var(--color-muted)" }}>
              Carico motore...
            </div>
          )}

          {/* Tentativo counter */}
          {attempts > 0 && verdict === null && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.625rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-faint)" }}>
              Tentativo {attempts} / 2
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Session results screen
// ────────────────────────────────────────────────────────────────────────────

function TrainerDone({
  groupLabel,
  results2: results2prop,
  results3: results3prop,
  positions,
  onClose,
}: {
  groupLabel: string;
  results2: PhaseResult[];
  results3: PhaseResult[];
  positions: PositionExample[];
  onClose: () => void;
}) {
  const total = positions.length;
  const perfect2 = results2prop.filter((r) => r.verdict === "perfect").length;
  const perfect3 = results3prop.filter((r) => r.verdict === "perfect").length;
  const good2 = results2prop.filter((r) => r.verdict === "good").length;
  const good3 = results3prop.filter((r) => r.verdict === "good").length;

  let nonnoLine = "";
  const score3 = perfect3 + good3;
  if (score3 >= total) {
    nonnoLine = "Tutte trovate. Hai riconosciuto il pattern. Continua cosi'.";
  } else if (score3 >= Math.ceil(total / 2)) {
    nonnoLine = `${score3} su ${total} abbastanza buone. Il pattern sta entrando.`;
  } else if (perfect3 > 0 || good3 > 0) {
    nonnoLine = `${score3 || 0} su ${total} trovate. Torna su questo gruppo. Il riconoscimento si allena.`;
  } else {
    nonnoLine = "Difficile questa volta. Ripartici sopra: la fase 'Guarda' aiuta.";
  }

  return (
    <div>
      <div className="tt-eyebrow" style={{ marginBottom: "0.5rem", color: "var(--color-muted)" }}>
        {groupLabel} · completato
      </div>
      <div className="tt-nonno" style={{ marginBottom: "1.5rem" }}>
        {nonnoLine}
      </div>

      {/* Score table */}
      <div style={{
        background: "var(--color-surface)", border: "1px solid var(--color-line)",
        borderRadius: "10px", overflow: "hidden", marginBottom: "1.5rem",
      }}>
        {[
          { label: "Con avversario", perfect: perfect2, good: good2, total },
          { label: "Da solo",        perfect: perfect3, good: good3, total },
        ].map((row) => (
          <div key={row.label} style={{
            display: "flex", alignItems: "center", gap: "1rem",
            padding: "0.875rem 1.125rem",
            borderBottom: "1px solid var(--color-line)",
          }}>
            <div style={{ flex: 1, fontSize: "0.88rem", color: "var(--color-text-soft)" }}>{row.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: "#34d399", fontWeight: 700 }}>{row.perfect}</span>
              <span style={{ color: "var(--color-faint)" }}> perfette</span>
              {row.good > 0 && (
                <>
                  <span style={{ color: "var(--color-faint)" }}> · </span>
                  <span style={{ color: "#facc15", fontWeight: 700 }}>{row.good}</span>
                  <span style={{ color: "var(--color-faint)" }}> buone</span>
                </>
              )}
              <span style={{ color: "var(--color-faint)" }}> / {row.total}</span>
            </div>
          </div>
        ))}
      </div>

      <button onClick={onClose} className="btn btn-ghost">
        Torna alle cadute
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main: CaduteTrainer
// ────────────────────────────────────────────────────────────────────────────

export interface CaduteTrainerProps {
  positions: PositionExample[];
  groupLabel: string;
  onClose: () => void;
}

export function CaduteTrainer({ positions, groupLabel, onClose }: CaduteTrainerProps) {
  const [phase, setPhase] = useState<TrainerPhase>("guarda");
  const [posIndex, setPosIndex] = useState(0);
  const [results2, setResults2] = useState<PhaseResult[]>([]);
  const [results3, setResults3] = useState<PhaseResult[]>([]);

  const validPositions = positions.filter(
    (p) => p.fen_before && p.best_uci,
  );

  // Empty state
  if (validPositions.length === 0) {
    return (
      <div style={{ padding: "2rem 0", textAlign: "center" }}>
        <div className="tt-nonno" style={{ marginBottom: "1rem" }}>
          Nessuna posizione disponibile per questo gruppo. Torneranno con la prossima analisi.
        </div>
        <button onClick={onClose} className="btn btn-ghost btn-sm">Indietro</button>
      </div>
    );
  }

  // With 1-2 positions skip phase 1 (the scroll makes no sense for 1 pos)
  const skipGuarda = validPositions.length < 2;

  function startFromBeginning() {
    setPhase(skipGuarda ? "con_avversario" : "guarda");
    setPosIndex(0);
    setResults2([]);
    setResults3([]);
  }

  // ── Phase transition logic ─────────────────────────────────────────────

  function handleGuardaDone() {
    setPhase("con_avversario");
    setPosIndex(0);
  }

  function handlePhase2Next(result: PhaseResult) {
    const newResults = [...results2, result];
    setResults2(newResults);
    if (posIndex + 1 < validPositions.length) {
      setPosIndex(posIndex + 1);
    } else {
      setPhase("da_solo");
      setPosIndex(0);
    }
  }

  function handlePhase3Next(result: PhaseResult) {
    const newResults = [...results3, result];
    setResults3(newResults);
    if (posIndex + 1 < validPositions.length) {
      setPosIndex(posIndex + 1);
    } else {
      setPhase("done");
      setPosIndex(0);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      <PhaseIndicator phase={phase} totalPositions={validPositions.length} />

      {phase === "guarda" && !skipGuarda && (
        <PhaseGuarda
          positions={validPositions}
          groupLabel={groupLabel}
          onNext={handleGuardaDone}
        />
      )}

      {phase === "con_avversario" && (
        <InteractivePuzzle
          pos={validPositions[posIndex] ?? validPositions[0]}
          showOpponent={true}
          posIndex={posIndex}
          posTotal={validPositions.length}
          phaseLabel={`Fase 2 · Con avversario — ${groupLabel}`}
          onNext={handlePhase2Next}
        />
      )}

      {phase === "da_solo" && (
        <InteractivePuzzle
          pos={validPositions[posIndex] ?? validPositions[0]}
          showOpponent={false}
          posIndex={posIndex}
          posTotal={validPositions.length}
          phaseLabel={`Fase 3 · Da solo — ${groupLabel}`}
          onNext={handlePhase3Next}
        />
      )}

      {phase === "done" && (
        <TrainerDone
          groupLabel={groupLabel}
          results2={results2}
          results3={results3}
          positions={validPositions}
          onClose={onClose}
        />
      )}

      {/* Skip guarda: auto-enter phase 2 on mount — handled by initial state above */}
      {/* Bottom back link (not in done screen) */}
      {phase !== "done" && (
        <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid var(--color-line)" }}>
          <button
            onClick={onClose}
            style={{
              fontSize: "0.75rem", color: "var(--color-muted)",
              background: "none", border: "none", cursor: "pointer",
              fontFamily: "var(--font-sans)", padding: 0,
            }}
          >
            Esci dall'allenamento
          </button>
          {phase !== "guarda" && (
            <button
              onClick={startFromBeginning}
              style={{
                marginLeft: "1.25rem",
                fontSize: "0.75rem", color: "var(--color-muted)",
                background: "none", border: "none", cursor: "pointer",
                fontFamily: "var(--font-sans)", padding: 0,
              }}
            >
              Ricomincia da capo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
