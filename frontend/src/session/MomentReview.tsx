/**
 * MomentReview.tsx — Fase 1 "Guardo, e Nonno parla".
 *
 * Voce di Nonno board-centrica, calma, in seconda persona.
 * Mostra drill_value esplicito (percentuali Maia mine vs target) se disponibili.
 * Mostra mossa di attesa se waiting_moves popolato; prova a calcolarla
 * on-demand via Stockfish (MultiPV) se p_maia_mine_top < 0.20 e waiting_moves
 * e' null. Timeout/skip graceful: mai inventare una mossa.
 *
 * DESIGN.md: flat, niente card-dentro-card, tt-nonno / sess-* tokens,
 * ORO solo per target (obiettivo), niente em-dash.
 */

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { PositionRow } from "../types";
import { BoardView } from "../components/BoardView";
import { useBoardFit } from "../components/useBoardFit";
import { useStockfish } from "../engine/useStockfish";

// ---------------------------------------------------------------------------
// Threshold: below this p_maia_mine_top we try to find a waiting move
// ---------------------------------------------------------------------------
const HARD_MOSSA_THRESHOLD = 0.20;   // posizione difficile per il giocatore
const WAITING_CP_LOSS_MAX = 50;       // mossa di attesa: perdita max in cp
const WAITING_TIMEOUT_MS = 4000;      // se Stockfish tarda, skip graceful

interface WaitingMove { san: string; cp_loss: number }

interface MomentReviewProps {
  position: PositionRow;
  index: number;   // 0-based
  total: number;
  maiaLevel: number;
  onNext: () => void;
  onPrev?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatItalianDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function normalizeSan(san: string | null | undefined): string {
  if (!san) return "";
  return san.replace(/[+#!?]+$/g, "").trim();
}

// Controlla se una mossa e' "forzante" (cattura, scacco, promozione, matto)
function isForcingMove(fen: string, san: string): boolean {
  try {
    const c = new Chess(fen);
    const mv = c.move(san, { strict: false } as never);
    if (!mv) return false;
    // Captures, checks, promotions
    return !!(mv.captured || mv.san.includes("+") || mv.san.includes("#") || mv.flags.includes("p"));
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Waiting moves: calcolo on-demand via Stockfish MultiPV
// ---------------------------------------------------------------------------

async function computeWaitingMoves(
  fen: string,
  bestSan: string | null,
  sf: ReturnType<typeof useStockfish>,
): Promise<WaitingMove[]> {
  // 1. Eval posizione di partenza (baseline)
  const evBase = await sf.evaluate(fen, { depth: 12 });
  const baseCp = evBase.scoreCp ?? 0;

  // MultiPV non ci da' i PV multipli direttamente dall'API (solo bestMoveUci).
  // Valutiamo i candidati legali non-forzanti individualmente.

  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });

  // Candidati da escludere: la best move, le forzanti
  const bestNorm = normalizeSan(bestSan);
  const candidates = legalMoves.filter((m) => {
    if (normalizeSan(m.san) === bestNorm) return false;
    if (isForcingMove(fen, m.san)) return false;
    return true;
  });

  // Ordina per tipo: prima mosse di re, poi arrocchi, poi mosse di pedone che non catturano
  // (euristico: le mosse di attesa sono spesso "mosse normalizzanti")
  const scored: WaitingMove[] = [];
  const toEval = candidates.slice(0, 6); // max 6 per non appesantire

  for (const mv of toEval) {
    try {
      const chess2 = new Chess(fen);
      chess2.move(mv.san);
      const fenAfter = chess2.fen();
      const evAfter = await sf.evaluate(fenAfter, { depth: 10 });
      // cp_loss dal mio POV: baseCp - (-evAfter.scoreCp) se siamo noi a muovere
      // (dopo la mossa, il POV si inverte: evAfter e' dal POV dell'avversario)
      const cpAfterMyPov = evAfter.scoreCp != null ? -evAfter.scoreCp : 0;
      const loss = Math.max(0, baseCp - cpAfterMyPov);
      if (loss <= WAITING_CP_LOSS_MAX) {
        scored.push({ san: mv.san, cp_loss: Math.round(loss) });
      }
    } catch { /* skip this candidate */ }
  }

  // Ordina per cp_loss asc (migliori prime)
  scored.sort((a, b) => a.cp_loss - b.cp_loss);
  return scored.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Voce Nonno — template puro, no LLM
// ---------------------------------------------------------------------------

const RIGA1_VARIANTS: ((san: string, sec: number | null) => string)[] = [
  (san, sec) => sec != null ? `Hai mosso ${san} in ${sec} secondi.` : `Hai giocato ${san}.`,
  (san, sec) => sec != null && sec < 3 ? `${san}, ${sec} secondi e via.` : sec != null ? `${sec} secondi per ${san}.` : `${san}.`,
  (san, sec) => sec != null && sec > 15 ? `Hai pensato ${sec} secondi e hai mosso ${san}.` : sec != null ? `${san}, dopo ${sec} secondi.` : `${san}.`,
];

const RIGA2_VARIANTS: ((best: string) => string)[] = [
  (best) => `La mossa giusta era ${best}.`,
  (best) => `Andava giocata ${best}.`,
  (best) => `${best} era la mossa.`,
];

// Riga difficolta' SENZA drill_value esplicito (fallback se i campi Maia mancano)
const RIGA3_HARD_VARIANTS: ((mine: number) => string)[] = [
  (mine) => `Per il tuo livello era quasi invisibile: la trovava ${mine} su 10.`,
  (mine) => `Solo ${mine} su 10 al tuo livello l'avrebbe trovata. Non era facile.`,
  (mine) => `Una mossa difficile per chiunque al tuo livello: ${mine} su 10.`,
];

const RIGA4_WAITING_VARIANTS: ((list: string) => string)[] = [
  (list) => `Quando non vedi il colpo, gioca solido: ${list}. Tengono la posizione.`,
  (list) => `Una mossa di attesa era la scelta onesta: ${list}. Aspettare, non forzare.`,
  (list) => `${list}: mosse d'attesa valide. Meglio di spingere a vuoto.`,
];

const RIGA4_FALLBACK_VARIANTS: (() => string)[] = [
  () => `Era difficile davvero. Guarda com'era la mossa giusta e tienila in mente.`,
  () => `Pochi la trovavano. La prossima volta, quando non vedi niente, rallenta.`,
  () => `In posizioni cosi', se non vedi un piano, gioca la mossa piu' sicura.`,
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface CoachContent {
  lines: string[];
  /** true se mostriamo le barre Maia separatamente */
  showDrillBars: boolean;
  pMine: number | null;
  pTarget: number | null;
}

function buildCoachContent(p: PositionRow, waitingComputed: WaitingMove[] | null): CoachContent {
  const lines: string[] = [];

  // Riga 1: hai mosso X in N secondi
  const sec = p.spent_seconds != null && p.spent_seconds > 0 ? Math.round(p.spent_seconds) : null;
  lines.push(pick(RIGA1_VARIANTS)(p.san, sec));

  // Riga 2: la mossa giusta era Y
  if (p.best_san_sf && p.best_san_sf !== p.san) {
    lines.push(pick(RIGA2_VARIANTS)(p.best_san_sf));
  }

  const pMine   = p.p_maia_mine_top   ?? null;
  const pTarget = p.p_maia_target_top ?? null;

  // Riga 3: difficolta' per il giocatore
  // Se abbiamo ENTRAMBI i valori Maia, mostriamo le barre graficamente
  // e la riga di testo e' solo un aggancio narrativo breve.
  const showDrillBars = pMine != null && pTarget != null;

  if (pMine != null && pMine < HARD_MOSSA_THRESHOLD) {
    if (!showDrillBars) {
      // Nessuna barra: frase compatta
      const nOf10 = Math.max(1, Math.round(pMine * 10));
      lines.push(pick(RIGA3_HARD_VARIANTS)(nOf10));
    }
    // Se showDrillBars==true, il testo narrativo e' rimpiazzato dal blocco visivo
  }

  // Riga 4: mossa di attesa (usa waiting_moves dalla pipeline; poi quelle calcolate)
  const waiting = (p.waiting_moves && p.waiting_moves.length > 0)
    ? p.waiting_moves
    : (waitingComputed && waitingComputed.length > 0 ? waitingComputed : null);

  if (waiting && waiting.length > 0) {
    const wm = waiting.slice(0, 3).map((w) => w.san).join(", ");
    lines.push(pick(RIGA4_WAITING_VARIANTS)(wm));
  } else if (pMine != null && pMine < HARD_MOSSA_THRESHOLD) {
    lines.push(pick(RIGA4_FALLBACK_VARIANTS)());
  }

  return { lines, showDrillBars, pMine, pTarget };
}

// ---------------------------------------------------------------------------
// DrillBars — barre grafiche % Maia
// ---------------------------------------------------------------------------

function DrillBars({ pMine, pTarget }: { pMine: number; pTarget: number }) {
  const mine   = Math.round(pMine * 100);
  const target = Math.round(pTarget * 100);
  return (
    <div className="sess-drill-bar" aria-label={`Percentuali: tu ${mine}%, il target ${target}%`}>
      {/* riga "tu" */}
      <div className="sess-drill-bar-row">
        <span className="sess-drill-bar-label">tu</span>
        <div className="sess-drill-bar-track">
          <div
            className="sess-drill-bar-fill"
            style={{
              width: `${mine}%`,
              background: "var(--color-brand-soft)",
            }}
          />
        </div>
        <span className="sess-drill-bar-pct" style={{ color: "var(--color-brand-soft)" }}>
          {mine}%
        </span>
      </div>
      {/* riga "target" */}
      <div className="sess-drill-bar-row">
        <span className="sess-drill-bar-label">target</span>
        <div className="sess-drill-bar-track">
          <div
            className="sess-drill-bar-fill"
            style={{
              width: `${target}%`,
              background: "var(--color-gold-soft)",
            }}
          />
        </div>
        <span className="sess-drill-bar-pct" style={{ color: "var(--color-gold-soft)" }}>
          {target}%
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MomentReview
// ---------------------------------------------------------------------------

export function MomentReview({ position, index, total, maiaLevel, onNext, onPrev }: MomentReviewProps) {
  const sf = useStockfish();
  const fit = useBoardFit({ min: 232, max: 460 });
  const orientation = position.my_color || "white";

  // Waiting moves calcolate on-demand
  const [waitingComputed, setWaitingComputed] = useState<WaitingMove[] | null>(null);
  const waitingAttemptedRef = useRef(false);

  const pMine = position.p_maia_mine_top ?? null;

  useEffect(() => {
    // Calcolo waiting moves solo se:
    // 1. la posizione e' difficile per il giocatore (p_maia_mine_top < soglia)
    // 2. waiting_moves NON e' gia' nella position row
    // 3. non abbiamo gia' tentato il calcolo
    if (waitingAttemptedRef.current) return;
    if ((position.waiting_moves && position.waiting_moves.length > 0)) return;
    if (pMine == null || pMine >= HARD_MOSSA_THRESHOLD) return;
    if (!sf.isReady) return;

    waitingAttemptedRef.current = true;

    // Timeout guard: if Stockfish is too slow, ignore a late result so a stale
    // waiting move never appears after the user has moved on. Skip gracefully:
    // Nonno says "era difficile davvero, guarda com'era la mossa giusta".
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
    }, WAITING_TIMEOUT_MS);

    computeWaitingMoves(position.fen_before, position.best_san_sf, sf)
      .then((moves) => {
        clearTimeout(timeoutId);
        if (timedOut) return;
        setWaitingComputed(moves.length > 0 ? moves : null);
      })
      .catch(() => {
        clearTimeout(timeoutId);
        // skip graceful — waitingComputed resta null
      });

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sf.isReady]);

  // Reset se cambia posizione
  useEffect(() => {
    waitingAttemptedRef.current = false;
    setWaitingComputed(null);
  }, [position.fen_before, position.ply]);

  // Freccia ultima mossa avversario
  const arrows = position.last_opp_from && position.last_opp_to
    ? [{ from: position.last_opp_from, to: position.last_opp_to, color: "#fde047" }]
    : [];
  const highlights = position.last_opp_from && position.last_opp_to
    ? [
        { square: position.last_opp_from, color: "#fde04755" },
        { square: position.last_opp_to, color: "#fde04788" },
      ]
    : [];

  const { lines, showDrillBars, pMine: pMineCoach, pTarget } = buildCoachContent(position, waitingComputed);
  const dateLabel = position.date ? formatItalianDate(position.date) : null;
  const moveLabel = position.move_number
    ? `${position.move_number}${orientation === "white" ? "." : "..."}`
    : null;

  // Mossa di attesa finale (dalla pipeline oppure calcolata)
  const waitingFinal = (position.waiting_moves && position.waiting_moves.length > 0)
    ? position.waiting_moves
    : waitingComputed;

  return (
    <div className="fade-in" style={{ width: "100%" }}>

      {/* Fase header */}
      <div className="sess-phase-header">
        <div className="sess-phase-dot">1</div>
        <span className="sess-phase-title">Guardo, e Nonno parla</span>
      </div>

      {/* Meta riga */}
      <div className="sess-moment-meta" style={{ marginBottom: "1.25rem" }}>
        <span className="val" style={{ color: "var(--color-brand-soft)", fontWeight: 600 }}>
          {index + 1} di {total}
        </span>
        {dateLabel && (
          <>
            <span className="dot">·</span>
            <span className="val">{dateLabel}</span>
          </>
        )}
        {position.opp_rating && (
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
        {maiaLevel && (
          <>
            <span className="dot">·</span>
            <span style={{ color: "var(--color-gold-soft)" }}>target {maiaLevel}</span>
          </>
        )}
      </div>

      {/* Layout board + pannello destra */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">

        {/* Board — ref on the frame; on desktop the auto-col sizes to fit.max,
              on mobile (grid-cols-1) the frame fills the row and clamps to fit.max. */}
        <div ref={fit.ref} className="sess-board-frame" style={{ width: "100%", maxWidth: fit.max }}>
          <BoardView
            fen={position.fen_before}
            orientation={orientation}
            size={fit.size}
            resetKey={`review-${position.game_id}:${position.ply}`}
            arrows={arrows}
            highlights={highlights}
          />
        </div>

        {/* Pannello destra */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Mosse precedenti — contesto */}
          {position.prev_moves && position.prev_moves.length > 0 && (
            <div className="sess-prev-moves">
              <div className="sess-prev-label">Prima di qui</div>
              <div className="sess-prev-sequence">
                {position.prev_moves.map((san, i) => (
                  <span key={i} className="sess-prev-move">{san}</span>
                ))}
                {moveLabel && (
                  <>
                    <span style={{ color: "var(--color-muted)", fontSize: "0.75rem" }}>→</span>
                    <span className="sess-prev-move sess-prev-current">
                      {moveLabel} {position.san}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Voce di Nonno */}
          <div className="sess-nonno">
            <span className="who">Nonno</span>
            {lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}

            {/* Barre drill_value esplicite (solo se entrambi i campi Maia presenti) */}
            {showDrillBars && pMineCoach != null && pTarget != null && (
              <div style={{ marginTop: "14px" }}>
                <p style={{
                  fontSize: "0.8125rem",
                  color: "var(--color-text-soft)",
                  marginBottom: "10px",
                  fontFamily: "var(--font-sans)",
                  fontWeight: 400,
                  lineHeight: 1.45,
                }}>
                  Questa la trova un{" "}
                  <b>{maiaLevel}</b>{" "}
                  il{" "}
                  <span style={{ color: "var(--color-gold-soft)", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                    {Math.round(pTarget * 100)}%
                  </span>{" "}
                  delle volte, tu il{" "}
                  <span style={{ color: "var(--color-brand-soft)", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                    {Math.round(pMineCoach * 100)}%
                  </span>.
                </p>
                <DrillBars pMine={pMineCoach} pTarget={pTarget} />
              </div>
            )}
          </div>

          {/* Mossa giocata vs mossa giusta */}
          <div className="sess-move-summary">
            <div className="sess-move-row">
              <span className="lbl">Mossa giocata</span>
              <span className="san" style={{ color: "var(--color-danger)" }}>{position.san}</span>
            </div>
            {position.best_san_sf && normalizeSan(position.best_san_sf) !== normalizeSan(position.san) && (
              <div className="sess-move-row">
                <span className="lbl">Mossa giusta</span>
                <span className="san" style={{ color: "var(--color-ok)" }}>{position.best_san_sf}</span>
              </div>
            )}
            {position.pv_san_sf && (
              <div className="sess-move-row">
                <span className="lbl">Seguito</span>
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  color: "var(--color-text-soft)",
                }}>
                  {position.pv_san_sf}
                </span>
              </div>
            )}
            {position.motif_label_it && (
              <div className="sess-move-row">
                <span className="lbl">Tema</span>
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  color: "var(--color-brand-soft)",
                }}>
                  {position.motif_label_it}
                </span>
              </div>
            )}
          </div>

          {/* Mossa di attesa — solo se presente (pipeline o calcolata) */}
          {waitingFinal && waitingFinal.length > 0 && (
            <div className="sess-waiting-moves">
              <div className="sess-waiting-label">Mosse d'attesa valide</div>
              <div className="sess-waiting-moves-list">
                {waitingFinal.slice(0, 3).map((wm, i) => (
                  <span key={i} className="tt-chip" style={{ fontFamily: "var(--font-mono)" }}>
                    {wm.san}
                    <span style={{ opacity: 0.55, fontSize: "0.6rem" }}>
                      {wm.cp_loss > 0 ? ` -${(wm.cp_loss / 100).toFixed(1)}` : ""}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Azioni */}
          <div className="sess-actions">
            {onPrev && (
              <button onClick={onPrev} className="btn btn-ghost">
                Indietro
              </button>
            )}
            <button
              onClick={onNext}
              className="btn btn-primary btn-lg"
              style={{ flex: 1, justifyContent: "center" }}
            >
              Avanti
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
