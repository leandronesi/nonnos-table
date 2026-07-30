/**
 * MomentReview.tsx — Fase 1 "Guardo, e Nonno parla".
 *
 * Voce di Nonno board-centrica, calma, in seconda persona.
 * Mostra indici Maia relativi sull'insieme osservato di mosse accettabili.
 * Mostra mossa di attesa se waiting_moves popolato; prova a calcolarla
 * on-demand via Stockfish (MultiPV) per posizioni target_relevant non marcate
 * alla portata oggi. Timeout/skip graceful: mai inventare una mossa.
 *
 * DESIGN.md: flat, niente card-dentro-card, tt-nonno / sess-* tokens,
 * ORO solo per target (obiettivo), niente em-dash.
 */

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { PositionRow } from "../types";
import { BoardView } from "../components/BoardView";
import { BoardScene } from "../components/BoardScene";
import { useBoardFit } from "../components/useBoardFit";
import { useStockfish } from "../engine/useStockfish";
import { tr, getLang } from "../i18n/lang";
import { buildMoveReason } from "./moveReason";
import { buildLevelCompare } from "./levelCompare";
import { shouldOfferWaitingMove, orderWaitingCandidates } from "./waitingMove";

// ---------------------------------------------------------------------------
// Waiting-move validation stays Stockfish-based; Maia only selects context.
// ---------------------------------------------------------------------------
const WAITING_CP_LOSS_MAX = 50; // mossa di attesa: perdita max in cp
const WAITING_TIMEOUT_MS = 4000; // se Stockfish tarda, skip graceful

interface WaitingMove {
  san: string;
  cp_loss: number;
}

interface MomentReviewProps {
  position: PositionRow;
  index: number; // 0-based
  total: number;
  maiaLevel: number;
  onNext: () => void;
  onPrev?: () => void;
  /**
   * If true, the BoardScene starts already risen (no entrance animation).
   * Pass when arriving via a View Transition morph from the Tavolo so the
   * board doesn't double-enter. Only meaningful on the first mount.
   */
  startRisen?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatItalianDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
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
    return !!(
      mv.captured ||
      mv.san.includes("+") ||
      mv.san.includes("#") ||
      mv.flags.includes("p")
    );
  } catch {
    return false;
  }
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

  // Prima le mosse "normalizzanti" (arrocco, re, spinta tranquilla): valutiamo
  // solo i primi 6, quindi l'ordine decide COSA viene valutato. Prima questo
  // ordinamento era descritto in un commento ma non implementato, e si
  // valutavano i primi 6 in ordine di scacchiera.
  const scored: WaitingMove[] = [];
  const toEval = orderWaitingCandidates(candidates).slice(0, 6);

  for (const mv of toEval) {
    try {
      const chess2 = new Chess(fen);
      chess2.move(mv.san);
      const fenAfter = chess2.fen();
      const evAfter = await sf.evaluate(fenAfter, { depth: 10 });
      // cp_loss dal mio POV: baseCp - (-evAfter.scoreCp) se siamo noi a muovere
      // (dopo la mossa, il POV si inverte: evAfter e' dal POV dell'avversario)
      const cpAfterMyPov =
        evAfter.scoreCp != null ? -evAfter.scoreCp : 0;
      const loss = Math.max(0, baseCp - cpAfterMyPov);
      if (loss <= WAITING_CP_LOSS_MAX) {
        scored.push({ san: mv.san, cp_loss: Math.round(loss) });
      }
    } catch {
      /* skip this candidate */
    }
  }

  // Ordina per cp_loss asc (migliori prime)
  scored.sort((a, b) => a.cp_loss - b.cp_loss);
  return scored.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Voce Nonno — template puro, no LLM
// All phrase-bank functions are called at render time (not at module load),
// so getLang() reads the current language and strings are never frozen.
// ---------------------------------------------------------------------------

function getRiga1Variants(): ((san: string, sec: number | null) => string)[] {
  if (getLang() === "en") {
    return [
      (san, sec) =>
        sec != null
          ? `You played ${san} in ${sec} seconds.`
          : `You played ${san}.`,
      (san, sec) =>
        sec != null && sec < 3
          ? `${san}, ${sec} seconds and gone.`
          : sec != null
            ? `${sec} seconds on ${san}.`
            : `${san}.`,
      (san, sec) =>
        sec != null && sec > 15
          ? `You thought for ${sec} seconds and played ${san} anyway.`
          : sec != null
            ? `${san}, after ${sec} seconds.`
            : `${san}.`,
    ];
  }
  return [
    (san, sec) =>
      sec != null ? `Hai mosso ${san} in ${sec} secondi.` : `Hai giocato ${san}.`,
    (san, sec) =>
      sec != null && sec < 3
        ? `${san}, ${sec} secondi e via.`
        : sec != null
          ? `${sec} secondi per ${san}.`
          : `${san}.`,
    (san, sec) =>
      sec != null && sec > 15
        ? `Hai pensato ${sec} secondi e hai mosso ${san}.`
        : sec != null
          ? `${san}, dopo ${sec} secondi.`
          : `${san}.`,
  ];
}

function getRiga2Variants(): ((best: string) => string)[] {
  if (getLang() === "en") {
    return [
      (best) => `The right move was ${best}.`,
      (best) => `${best} was the move to play.`,
      (best) => `${best} was the move.`,
    ];
  }
  return [
    (best) => `La mossa giusta era ${best}.`,
    (best) => `Andava giocata ${best}.`,
    (best) => `${best} era la mossa.`,
  ];
}

function buildMaiaContextLine(p: PositionRow): string | null {
  if (p.maia_status && p.maia_status !== "scored") {
    return tr(
      "Maia non ha valutato questa posizione: qui restiamo ai fatti della scacchiera.",
      "Maia did not score this position, so we stay with the board facts here.",
    );
  }
  if (p.avoidable_at_current === true) {
    return tr(
      "La policy Maia al livello attuale assegna supporto alle alternative accettabili osservate: e' un segnale relativo, non una probabilita' calibrata.",
      "The current-level Maia policy supports the observed acceptable alternatives: this is a relative signal, not a calibrated probability.",
    );
  }
  if (p.target_relevant === true) {
    return tr(
      "Maia associa le alternative accettabili piu' al livello obiettivo che a quello attuale: e' materiale per il tuo percorso, non una frequenza umana.",
      "Maia associates the acceptable alternatives more with your target level than your current one: training material for your path, not a human frequency.",
    );
  }
  if (p.trainable === true) {
    return tr(
      "I segnali Maia selezionano questa posizione come allenabile nel tuo percorso.",
      "Maia's signals select this position as trainable along your path.",
    );
  }
  return null;
}

function getRiga4WaitingVariants(): ((list: string) => string)[] {
  if (getLang() === "en") {
    return [
      (list) =>
        `When you do not see the winning line, play solid: ${list}. Both keep the position.`,
      (list) =>
        `A waiting move was the honest choice: ${list}. When you do not see the line, do not push.`,
      (list) =>
        `${list}: valid waiting moves. Better than forcing when you do not see it.`,
    ];
  }
  return [
    (list) =>
      `Quando non vedi il colpo, gioca solido: ${list}. Tengono la posizione.`,
    (list) =>
      `Una mossa di attesa era la scelta onesta: ${list}. Aspettare, non forzare.`,
    (list) =>
      `${list}: mosse d'attesa valide. Meglio di spingere a vuoto.`,
  ];
}

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

function buildCoachContent(
  p: PositionRow,
  waitingComputed: WaitingMove[] | null,
): CoachContent {
  const lines: string[] = [];

  // Riga 1: hai mosso X in N secondi
  const sec =
    p.spent_seconds != null && p.spent_seconds > 0
      ? Math.round(p.spent_seconds)
      : null;
  lines.push(pick(getRiga1Variants())(p.san, sec));

  // Riga 2: la mossa giusta era Y
  if (p.best_san_sf && p.best_san_sf !== p.san) {
    lines.push(pick(getRiga2Variants())(p.best_san_sf));
  }

  const pMine = p.maia_mine_acceptable_observed_policy ?? null;
  const pTarget = p.maia_target_acceptable_observed_policy ?? null;

  // Riga 3: semantica esplicita current/target, mai frequenza umana.
  const showDrillBars = pMine != null && pTarget != null;
  const maiaContext = buildMaiaContextLine(p);
  if (maiaContext) lines.push(maiaContext);

  // Riga 4: mossa di attesa (usa waiting_moves dalla pipeline; poi quelle calcolate)
  const waiting =
    p.waiting_moves && p.waiting_moves.length > 0
      ? p.waiting_moves
      : waitingComputed && waitingComputed.length > 0
        ? waitingComputed
        : null;

  if (waiting && waiting.length > 0) {
    const wm = waiting
      .slice(0, 3)
      .map((w) => w.san)
      .join(", ");
    lines.push(pick(getRiga4WaitingVariants())(wm));
  }

  return { lines, showDrillBars, pMine, pTarget };
}

// ---------------------------------------------------------------------------
// DrillBars — indici relativi Maia sulle mosse accettabili osservate
// ---------------------------------------------------------------------------

function DrillBars({
  pMine,
  pTarget,
  maiaLevel,
}: {
  pMine: number;
  pTarget: number;
  maiaLevel?: number | null;
}) {
  const mine = Math.round(pMine * 100);
  const target = Math.round(pTarget * 100);
  const fallbackLabel = tr("all'obiettivo", "at target");
  return (
    <div
      className="sess-drill-bar"
      aria-label={tr(
        `Indici Maia relativi: oggi ${mine}, ${maiaLevel != null ? `a ${maiaLevel}` : "all'obiettivo"} ${target}`,
        `Relative Maia indices: today ${mine}, ${maiaLevel != null ? `at ${maiaLevel}` : "at target"} ${target}`,
      )}
    >
      {/* today row */}
      <div className="sess-drill-bar-row">
        <span className="sess-drill-bar-label">{tr("oggi", "today")}</span>
        <div className="sess-drill-bar-track">
          <div
            className="sess-drill-bar-fill"
            style={{
              width: `${mine}%`,
              background: "var(--color-brand-soft)",
            }}
          />
        </div>
        <span
          className="sess-drill-bar-pct"
          style={{ color: "var(--color-brand-soft)" }}
        >
          {mine}
        </span>
      </div>
      {/* target row */}
      <div className="sess-drill-bar-row">
        <span className="sess-drill-bar-label">
          {maiaLevel ?? fallbackLabel}
        </span>
        <div className="sess-drill-bar-track">
          <div
            className="sess-drill-bar-fill"
            style={{
              width: `${target}%`,
              background: "var(--color-gold-soft)",
            }}
          />
        </div>
        <span
          className="sess-drill-bar-pct"
          style={{ color: "var(--color-gold-soft)" }}
        >
          {target}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MomentReview
// ---------------------------------------------------------------------------

export function MomentReview({
  position,
  index,
  total,
  maiaLevel,
  onNext,
  onPrev,
  startRisen = false,
}: MomentReviewProps) {
  const sf = useStockfish();
  const fit = useBoardFit({ min: 232, max: 460 });
  const orientation = position.my_color || "white";

  // Waiting moves calcolate on-demand
  const [waitingComputed, setWaitingComputed] = useState<
    WaitingMove[] | null
  >(null);
  const waitingAttemptedRef = useRef(false);

  // Condizione canonica (BUILD.md §SLICE 4): la mossa giusta e' troppo
  // difficile per il livello attuale. La versione precedente usava
  // `target_relevant && avoidable_at_current !== true`, che non e' la stessa
  // cosa: `!== true` include null, quindi la mossa d'attesa compariva anche
  // quando il dato semplicemente mancava.
  const shouldComputeWaitingMove = shouldOfferWaitingMove({
    pMaiaMineTop: position.p_maia_mine_top,
    maiaStatus: position.maia_status,
  });

  useEffect(() => {
    // Calcolo waiting moves solo se:
    // 1. la posizione e' pertinente al target ma non marcata current-avoidable
    // 2. waiting_moves NON e' gia' nella position row
    // 3. non abbiamo gia' tentato il calcolo
    if (waitingAttemptedRef.current) return;
    if (position.waiting_moves && position.waiting_moves.length > 0) return;
    if (!shouldComputeWaitingMove) return;
    if (!sf.isReady) return;

    waitingAttemptedRef.current = true;

    // Timeout guard: if Stockfish is too slow, ignore a late result so a stale
    // waiting move never appears after the user has moved on. Skip gracefully:
    // Nessun risultato tardivo viene presentato come verita' sulla posizione.
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
  }, [sf.isReady, shouldComputeWaitingMove, position.fen_before, position.best_san_sf]);

  // Reset se cambia posizione
  useEffect(() => {
    waitingAttemptedRef.current = false;
    setWaitingComputed(null);
  }, [position.fen_before, position.ply]);

  // Freccia ultima mossa avversario
  const arrows =
    position.last_opp_from && position.last_opp_to
      ? [
          {
            from: position.last_opp_from,
            to: position.last_opp_to,
            color: "#fde047",
          },
        ]
      : [];
  const highlights =
    position.last_opp_from && position.last_opp_to
      ? [
          { square: position.last_opp_from, color: "#fde04755" },
          { square: position.last_opp_to, color: "#fde04788" },
        ]
      : [];

  const {
    lines,
    showDrillBars,
    pMine: pMineCoach,
    pTarget,
  } = buildCoachContent(position, waitingComputed);
  const dateLabel = position.date ? formatItalianDate(position.date) : null;
  const moveLabel = position.move_number
    ? `${position.move_number}${orientation === "white" ? "." : "..."}`
    : null;

  // Mossa di attesa finale (dalla pipeline oppure calcolata)
  const waitingFinal =
    position.waiting_moves && position.waiting_moves.length > 0
      ? position.waiting_moves
      : waitingComputed;

  return (
    <div className="fade-in" style={{ width: "100%" }}>
      {/* Fase header */}
      <div className="sess-phase-header">
        <div className="sess-phase-dot">1</div>
        <span className="sess-phase-title">
          {tr("Guardo, e Nonno parla", "I look, and Nonno speaks")}
        </span>
      </div>

      {/* Meta riga */}
      <div className="sess-moment-meta" style={{ marginBottom: "1.25rem" }}>
        <span
          className="val"
          style={{ color: "var(--color-brand-soft)", fontWeight: 600 }}
        >
          {index + 1} {tr("di", "of")} {total}
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
            <span style={{ color: "var(--color-gold-soft)" }}>
              {tr("obiettivo", "target")} {maiaLevel}
            </span>
          </>
        )}
      </div>

      {/* Layout board + pannello destra */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">
        {/* Board — BoardScene wraps from outside; fit.ref stays on the inner
              frame (callback ref pattern, fix b10ee1a: avoids missing re-observation
              after a keyed remount). BoardScene blocks interaction until risen.
              viewTransitionName on sess-board-frame pairs with the same name on
              momento-board-wrap in MomentoDelGiorno for the shared-element morph. */}
        <BoardScene
          sceneKey={`review-${position.game_id}:${position.ply}`}
          startRisen={startRisen}
        >
          <div
            ref={fit.ref}
            className="sess-board-frame"
            style={{
              width: "100%",
              maxWidth: `min(${fit.max}px, calc(100vw - 1.5rem))`,
              viewTransitionName: "tavolo-board",
            }}
          >
            <BoardView
              fen={position.fen_before}
              orientation={orientation}
              size={fit.size}
              resetKey={`review-${position.game_id}:${position.ply}`}
              arrows={arrows}
              highlights={highlights}
            />
          </div>
        </BoardScene>

        {/* Pannello destra */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Mosse precedenti — contesto */}
          {position.prev_moves && position.prev_moves.length > 0 && (
            <div className="sess-prev-moves">
              <div className="sess-prev-label">
                {tr("Prima di qui", "Before this")}
              </div>
              <div className="sess-prev-sequence">
                {position.prev_moves.map((san, i) => (
                  <span key={i} className="sess-prev-move">
                    {san}
                  </span>
                ))}
                {moveLabel && (
                  <>
                    <span
                      style={{
                        color: "var(--color-muted)",
                        fontSize: "0.75rem",
                      }}
                    >
                      →
                    </span>
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

            {/* Spiegazione verificabile costruita solo dai dati della posizione. */}
            {(() => {
              // Only show when there is a genuine error (best !== played)
              const normSan = (s: string | null | undefined) =>
                (s ?? "").replace(/[+#!?]+$/, "").trim();
              if (
                !position.best_san_sf ||
                normSan(position.best_san_sf) === normSan(position.san)
              )
                return null;

              const displayText: string | null = buildMoveReason({
                fenBefore: position.fen_before,
                myColor: position.my_color,
                playedSan: position.san,
                bestUci: position.best_uci ?? null,
                bestSan: position.best_san_sf,
                motif: position.motif,
                phase: position.phase,
                lastOppSan: position.last_opp_san,
              });

              if (!displayText) return null;

              return (
                <p
                  style={{
                    fontSize: "0.82rem",
                    color: "var(--color-text-soft)",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 400,
                    lineHeight: 1.55,
                    marginTop: "4px",
                    opacity: 0.85,
                  }}
                >
                  {displayText}
                </p>
              );
            })()}

            {/* Firma #2 in voce: "piu' naturale al target" (PRODUCT.md §0.6).
                Sta SOPRA gli indici: Nonno parla, i numeri restano dettaglio. */}
            {(() => {
              const levelLine = buildLevelCompare({
                pMineAcceptable: position.maia_mine_acceptable_observed_policy,
                pTargetAcceptable: position.maia_target_acceptable_observed_policy,
                targetRating: maiaLevel,
                maiaStatus: position.maia_status,
              });
              if (!levelLine) return null;
              return (
                <p className="tt-nonno" style={{ marginTop: "14px" }}>
                  {levelLine}
                </p>
              );
            })()}

            {/* Indici raw Maia (solo se entrambi i campi espliciti sono presenti). */}
            {showDrillBars && pMineCoach != null && pTarget != null && (
              <div style={{ marginTop: "14px" }}>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--color-text-soft)",
                    marginBottom: "10px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 400,
                    lineHeight: 1.45,
                  }}
                >
                  {tr("Indice relativo delle mosse accettabili osservate:", "Relative index for the observed acceptable moves:")}{" "}
                  <b>{tr("target", "target")} {maiaLevel}:</b>{" "}
                  <span
                    style={{
                      color: "var(--color-gold-soft)",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {Math.round(pTarget * 100)}
                  </span>{" "}
                  {tr(", oggi", ", today")}{" "}
                  <span
                    style={{
                      color: "var(--color-brand-soft)",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {Math.round(pMineCoach * 100)}
                  </span>
                  {tr(". Sono masse di policy del modello, non frequenze umane.", ". These are model policy masses, not human frequencies.")}
                </p>
                <DrillBars
                  pMine={pMineCoach}
                  pTarget={pTarget}
                  maiaLevel={maiaLevel}
                />
              </div>
            )}
          </div>

          {/* Mossa giocata vs mossa giusta */}
          <div className="sess-move-summary">
            <div className="sess-move-row">
              <span className="lbl">{tr("Mossa giocata", "Move played")}</span>
              <span
                className="san"
                style={{ color: "var(--color-danger)" }}
              >
                {position.san}
              </span>
            </div>
            {position.best_san_sf &&
              normalizeSan(position.best_san_sf) !==
                normalizeSan(position.san) && (
                <div className="sess-move-row">
                  <span className="lbl">
                    {tr("Mossa giusta", "Right move")}
                  </span>
                  <span
                    className="san"
                    style={{ color: "var(--color-ok)" }}
                  >
                    {position.best_san_sf}
                  </span>
                </div>
              )}
            {position.pv_san_sf && (
              <div className="sess-move-row">
                <span className="lbl">{tr("Seguito", "Line")}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem",
                    color: "var(--color-text-soft)",
                  }}
                >
                  {position.pv_san_sf}
                </span>
              </div>
            )}
            {position.motif_label_it && (
              <div className="sess-move-row">
                <span className="lbl">{tr("Tema", "Theme")}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem",
                    color: "var(--color-brand-soft)",
                  }}
                >
                  {position.motif_label_it}
                </span>
              </div>
            )}
          </div>

          {/* Mossa di attesa — solo se presente (pipeline o calcolata) */}
          {waitingFinal && waitingFinal.length > 0 && (
            <div className="sess-waiting-moves">
              <div className="sess-waiting-label">
                {tr("Mosse d'attesa valide", "Valid waiting moves")}
              </div>
              <div className="sess-waiting-moves-list">
                {waitingFinal.slice(0, 3).map((wm, i) => (
                  <span
                    key={i}
                    className="tt-chip"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {wm.san}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Azioni */}
          <div className="sess-actions">
            {onPrev && (
              <button onClick={onPrev} className="btn btn-ghost">
                {tr("Indietro", "Back")}
              </button>
            )}
            <button
              onClick={onNext}
              className="btn btn-primary btn-lg"
              style={{ flex: 1, justifyContent: "center" }}
            >
              {tr("Avanti", "Next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
