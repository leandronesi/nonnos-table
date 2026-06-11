import { useEffect, useRef, useState, useCallback } from "react";
import { Chess } from "chess.js";
import { BoardView } from "../components/BoardView";
import { BoardLegend } from "../components/BoardLegend";
import { BoardScene } from "../components/BoardScene";
import { useBoardFit } from "../components/useBoardFit";
import { CoachNote } from "../components/CoachNote";
import { SureCheck } from "../components/SureCheck";
import { useStockfish } from "../engine/useStockfish";
import { turnFromFen } from "../chess-utils";
import type { PlayResult } from "./store";
import type { CoachSession } from "../types";
import { stockfishSkillForMaiaLevel, sessionFallbackLine } from "../coaching";

interface Props {
  startFen: string;             // posizione di partenza (di solito da un turning point)
  myColor?: "white" | "black";  // override opzionale; di default derivato da startFen (chi muove)
  maiaLevel?: number;           // livello target dichiarato (es. 1600); se assente usa skillLevel legacy
  skillLevel?: number;          // 0-20, usato solo se maiaLevel non passato (legacy)
  currentRating?: number;       // rating corrente del giocatore (per sub-text contestuale)
  timeClass?: string;           // categoria di tempo dichiarata (rapid / blitz / bullet / classical)
  coachSession?: CoachSession;  // frasi pre-generate da Nonno
  onDone: (r: PlayResult) => void;
}

// Soglia centipawn loss per attivare "sei sicuro?": sotto questa, niente
// overlay (è rumore). Sopra, Nonno interrompe.
const SURE_CHECK_CP_LOSS_THRESHOLD = 180;

// Profondità eval per il check pre-mossa. Compromesso tra velocità (eval
// gira nel browser) e qualità. Depth 10 = ~200-400ms.
const SURE_CHECK_EVAL_DEPTH = 10;

interface PendingSureCheck {
  from: string;
  to: string;
  phrase: string;
  threatSquare: string;
}

// ---------------------------------------------------------------------------
// Hint system — Nonno in partita (§6.8 BUILD.md)
// ---------------------------------------------------------------------------

const HINT_TIMER_MS = 12000; // ~12s idle prima che Nonno offra l'indizio

// Tier 1 phrases — "dove guardare", mai la mossa
const HINT_T1_TACTICAL = [
  "Aspetta. Qui c'e' qualcosa. Guarda le catture e i pezzi scoperti.",
  "Prima di muovere: c'e' un guadagno materiale disponibile. Lo vedi?",
  "Fermati un secondo. Controlla se puoi prendere qualcosa.",
];
const HINT_T1_UNDER_ATTACK = [
  "Occhio prima di muovere: un tuo pezzo e' sotto tiro.",
  "Aspetta. Conta gli attaccanti sul tuo pezzo. Piu' di quanti difensori hai?",
  "Fermati: qualcosa di tuo e' in pericolo. Guarda bene.",
];
const HINT_T1_QUIET = [
  "Niente di forzato. Migliora il pezzo che sta peggio, o porta un pezzo verso il suo re.",
  "Posizione tranquilla. Non cercare il capolavoro: gioca la mossa piu' solida che vedi.",
  "Non c'e' niente di immediato. Centralizza, poi pensa a dove vuoi andare.",
];

// Tier 2 prompt — "parti da qui"
const HINT_T2_PHRASES = [
  "Parti da li'.",
  "Il pezzo che cerchi parte da quella casa.",
  "Da quella casa si muove la mossa giusta.",
];

// ---------------------------------------------------------------------------
// Position analysis for hint: uses chess.js only (sync, no engine needed)
// ---------------------------------------------------------------------------

type MomentKind = "tactical" | "under_attack" | "quiet";

function analyzePosition(fen: string, myColor: "white" | "black"): MomentKind {
  try {
    const b = new Chess(fen);
    const legalMoves = b.moves({ verbose: true });

    // 1. Check if any of my legal moves is a capture (tactical opportunity)
    const hasCaptureAvailable = legalMoves.some((m) => m.captured);
    if (hasCaptureAvailable) return "tactical";

    // 2. Check if any of my pieces is attacked and undefended
    // We flip the board to the opponent's turn and see what they can take
    // (quick heuristic: look for any capturing move available for the opponent
    // by examining the current position from the other side)
    const fenParts = fen.split(" ");
    const oppTurn = myColor === "white" ? "b" : "w";
    // Build a fen where it's the opponent's turn to see what they can capture
    const oppFen = [fenParts[0], oppTurn, ...fenParts.slice(2)].join(" ");
    try {
      const bOpp = new Chess(oppFen);
      const oppMoves = bOpp.moves({ verbose: true });
      const oppCanCapture = oppMoves.some((m) => m.captured);
      if (oppCanCapture) return "under_attack";
    } catch { /* fallback to quiet */ }

    return "quiet";
  } catch {
    return "quiet";
  }
}

// Extract the from-square of a UCI move string
function uciFrom(uci: string): string | null {
  if (!uci || uci.length < 4) return null;
  const sq = uci.slice(0, 2);
  return /^[a-h][1-8]$/.test(sq) ? sq : null;
}

// Convert UCI to SAN in a given position
function uciToSan(fen: string, uci: string): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const b = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci.length > 4 ? uci[4] : undefined;
    const mv = b.move({ from, to, promotion: promo || "q" } as never);
    return mv ? mv.san : null;
  } catch { return null; }
}

interface HintState {
  tier: 1 | 2 | 3;
  text: string;
  /** Square to highlight for Tier 2 (from-square of best move) */
  hintSquare: string | null;
  /** Arrow for Tier 3: from → to */
  hintArrow: { from: string; to: string } | null;
  /** Waiting move SAN to show at Tier 3 if position is too hard */
  waitingSan: string | null;
  /** True while the engine is computing */
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Frasi inline Nonno — no LLM, random pick
// ---------------------------------------------------------------------------

const RIPENSACI_PHRASES = [
  "Mh, bravo. Guarda di nuovo.",
  "Aspetta, riguardiamo la posizione.",
  "Eh, hai cambiato idea. Si fa.",
];

const RIPROVO_AFTER_SURE_PHRASES = [
  "Bravo, hai guardato. Adesso prova un'altra.",
  "Bene così. Ferma la mano, poi gioca.",
  "Oooh, hai sentito. Riprova.",
];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function maiaSubText(currentRating: number | undefined, maiaLevel: number): string {
  const cur = currentRating ?? maiaLevel;
  if (cur < maiaLevel - 50) return `Giochi da una posizione che hai vissuto, contro un ${maiaLevel}. Vediamo come la gestisce lui.`;
  if (cur >= maiaLevel) return "Sei al suo livello. Niente regali.";
  return `Ci sei quasi. Gioca la posizione come la giocherebbe lui.`;
}


/**
 * Una partita vs MAIA (Stockfish calibrato sul livello target) dalla
 * posizione data. Termina quando finisce la partita (matto/stalemate/draw)
 * o l'utente clicca "Termina sessione".
 *
 * BLOCK 3 — "sei sicuro?": prima di committare ogni mia mossa, eval
 * Stockfish before/after. Se la perdita stimata supera la soglia E la
 * best avversaria è una cattura su un mio pezzo, mostro overlay con
 * voce di Nonno.
 *
 * TASK D — Rewind/Undo: bottone "Ripensaci" disponibile dopo ogni mia
 * mossa finché l'engine non ha risposto. Cancella il timer engine e
 * ripristina la posizione precedente.
 */
export function PlayStep({
  startFen,
  myColor: myColorProp,
  maiaLevel,
  skillLevel: skillLevelProp,
  currentRating,
  timeClass: _timeClass,
  coachSession,
  onDone,
}: Props) {
  // Deriva skillLevel da maiaLevel se disponibile, altrimenti prop legacy
  const skillLevel = maiaLevel != null
    ? stockfishSkillForMaiaLevel(maiaLevel)
    : (skillLevelProp ?? 8);
  const sf = useStockfish();
  const fit = useBoardFit({ min: 232, max: 500 });
  const myColor: "white" | "black" = myColorProp || turnFromFen(startFen);
  const boardRef = useRef<Chess>(new Chess(startFen));
  const [fen, setFen] = useState<string>(startFen);
  const [history, setHistory] = useState<string[]>([]);
  const [engineThinking, setEngineThinking] = useState(false);
  const [outcome, setOutcome] = useState<PlayResult["outcome"] | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string; by: "me" | "engine" } | null>(null);
  const [evaluatingMove, setEvaluatingMove] = useState(false);
  const [pendingSure, setPendingSure] = useState<PendingSureCheck | null>(null);

  // Messaggio Nonno inline (undo / restart / ripensaci)
  const [coachInline, setCoachInline] = useState<string | null>(null);
  const engineTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hint system state
  const [hint, setHint] = useState<HintState | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track fen at the time the hint was requested to avoid stale results
  const hintFenRef = useRef<string>("");

  useEffect(() => {
    const sideToMove = turnFromFen(startFen);
    if (sideToMove !== myColor && !outcome) {
      engineMove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-clear coachInline dopo 4.5s
  useEffect(() => {
    if (!coachInline) return;
    const t = setTimeout(() => setCoachInline(null), 4500);
    return () => clearTimeout(t);
  }, [coachInline]);

  // ---------------------------------------------------------------------------
  // Hint: computeHint — calcola il Tier 1 (+ engine async per Tier 2/3)
  // ---------------------------------------------------------------------------
  const computeHint = useCallback(async (currentFen: string, tier: 1 | 2 | 3) => {
    const moment = analyzePosition(currentFen, myColor);

    if (tier === 1) {
      let text: string;
      if (moment === "tactical") text = pickRandom(HINT_T1_TACTICAL);
      else if (moment === "under_attack") text = pickRandom(HINT_T1_UNDER_ATTACK);
      else text = pickRandom(HINT_T1_QUIET);

      setHint({ tier: 1, text, hintSquare: null, hintArrow: null, waitingSan: null, loading: false });
      return;
    }

    // Tier 2 or 3: need Stockfish
    setHint((prev) => ({
      tier,
      text: prev?.text ?? pickRandom(tier === 2 ? HINT_T2_PHRASES : ["Ecco la mossa."]),
      hintSquare: prev?.hintSquare ?? null,
      hintArrow: null,
      waitingSan: null,
      loading: true,
    }));

    // Race against a 5s timeout — never block the game
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));

    try {
      const evPromise = sf.evaluate(currentFen, { depth: 12 });
      const ev = await Promise.race([evPromise, timeout]);

      // Stale check: fen may have changed while engine was thinking
      if (hintFenRef.current !== currentFen) return;

      if (!ev || !ev.bestMoveUci) {
        // Graceful fallback to Tier 1 text
        const moment2 = analyzePosition(currentFen, myColor);
        let fallback: string;
        if (moment2 === "tactical") fallback = pickRandom(HINT_T1_TACTICAL);
        else if (moment2 === "under_attack") fallback = pickRandom(HINT_T1_UNDER_ATTACK);
        else fallback = pickRandom(HINT_T1_QUIET);
        setHint({ tier: 1, text: fallback, hintSquare: null, hintArrow: null, waitingSan: null, loading: false });
        return;
      }

      const bestUci = ev.bestMoveUci;
      const fromSq = uciFrom(bestUci);
      const toSq = bestUci.length >= 4 ? bestUci.slice(2, 4) : null;

      if (tier === 2) {
        const t2text = pickRandom(HINT_T2_PHRASES);
        setHint({
          tier: 2,
          text: t2text,
          hintSquare: fromSq,
          hintArrow: null,
          waitingSan: null,
          loading: false,
        });
      } else {
        // Tier 3: show the full move
        const bestSan = uciToSan(currentFen, bestUci);
        const moveText = bestSan ? `La mossa e' ${bestSan}.` : "Guarda la freccia sulla scacchiera.";

        // Check if position is "too hard" (p_maia_mine_top low proxy: swing > 150cp)
        const isSwing = ev.scoreCp != null && Math.abs(ev.scoreCp) > 150;
        // Try to find a waiting move when position is a big swing (hard to see)
        let waitingSan: string | null = null;
        if (isSwing) {
          try {
            const b = new Chess(currentFen);
            const legals = b.moves({ verbose: true });
            const bestNorm = bestSan ?? "";
            const candidates = legals.filter((m) => {
              if (m.san === bestNorm) return false;
              if (m.captured || m.san.includes("+") || m.san.includes("#")) return false;
              return true;
            }).slice(0, 4);

            for (const cand of candidates) {
              if (hintFenRef.current !== currentFen) break;
              const b2 = new Chess(currentFen);
              b2.move(cand.san);
              const evW = await sf.evaluate(b2.fen(), { depth: 8 });
              if (hintFenRef.current !== currentFen) break;
              const cpLoss = Math.max(0, (ev.scoreCp ?? 0) - (-(evW.scoreCp ?? 0)));
              if (cpLoss <= 50) {
                waitingSan = cand.san;
                break;
              }
            }
          } catch { /* skip waiting move */ }
        }

        if (hintFenRef.current !== currentFen) return;

        const fullText = waitingSan
          ? `${moveText} Se non la vedi, una solida e' ${waitingSan}.`
          : moveText;

        setHint({
          tier: 3,
          text: fullText,
          hintSquare: fromSq,
          hintArrow: fromSq && toSq ? { from: fromSq, to: toSq } : null,
          waitingSan,
          loading: false,
        });
      }
    } catch {
      if (hintFenRef.current !== currentFen) return;
      // Graceful fallback
      const moment3 = analyzePosition(currentFen, myColor);
      let fb: string;
      if (moment3 === "tactical") fb = pickRandom(HINT_T1_TACTICAL);
      else if (moment3 === "under_attack") fb = pickRandom(HINT_T1_UNDER_ATTACK);
      else fb = pickRandom(HINT_T1_QUIET);
      setHint({ tier: 1, text: fb, hintSquare: null, hintArrow: null, waitingSan: null, loading: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myColor, sf]);

  // ---------------------------------------------------------------------------
  // Hint: reset timer every time the fen changes or turn changes
  // ---------------------------------------------------------------------------
  const isMyTurn = !outcome && !engineThinking && !evaluatingMove && !pendingSure
    && turnFromFen(fen) === myColor;

  useEffect(() => {
    // Clear hint and timer on every fen/turn change
    setHint(null);
    hintFenRef.current = fen;
    if (hintTimerRef.current !== null) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    if (!isMyTurn) return;

    // Start the 12s timer
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      // Only trigger if still my turn and no hint showing yet
      if (hintFenRef.current === fen) {
        computeHint(fen, 1);
      }
    }, HINT_TIMER_MS);

    return () => {
      if (hintTimerRef.current !== null) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, isMyTurn]);


  async function engineMove() {
    setEngineThinking(true);
    try {
      const fenNow = boardRef.current.fen();
      const uci = await sf.playMove(fenNow, { depth: 10, skillLevel });
      if (!uci) return;
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promo = uci.length > 4 ? uci[4] : undefined;
      const mv = boardRef.current.move({ from, to, promotion: promo || "q" } as never);
      if (!mv) return;
      setFen(boardRef.current.fen());
      setHistory((h) => [...h, mv.san]);
      setLastMove({ from: mv.from, to: mv.to, by: "engine" });
      checkGameOver();
    } finally {
      setEngineThinking(false);
    }
  }

  function checkGameOver(): boolean {
    const b = boardRef.current;
    if (!b.isGameOver()) return false;
    let res: PlayResult["outcome"];
    if (b.isCheckmate()) {
      const loser = b.turn() === "w" ? "white" : "black";
      res = loser === myColor ? "loss" : "win";
    } else {
      res = "draw";
    }
    setOutcome(res);
    return true;
  }

  async function onDrop(from: string, to: string): Promise<boolean> {
    if (outcome || engineThinking || evaluatingMove || pendingSure) return false;
    const sideToMove = turnFromFen(boardRef.current.fen());
    if (sideToMove !== myColor) return false;

    // valida la mossa su una copia (non tocca boardRef finché non commit)
    const fenBeforeMine = boardRef.current.fen();
    const probe = new Chess(fenBeforeMine);
    const mv = probe.move({ from, to, promotion: "q" } as never);
    if (!mv) return false;
    const fenAfterMine = probe.fen();

    setEvaluatingMove(true);
    try {
      const [evBefore, evAfter] = await Promise.all([
        sf.evaluate(fenBeforeMine, { depth: SURE_CHECK_EVAL_DEPTH }),
        sf.evaluate(fenAfterMine, { depth: SURE_CHECK_EVAL_DEPTH }),
      ]);
      const iAmWhite = myColor === "white";
      const cpBefore = scoreFromMyPov(evBefore.scoreCp ?? 0, evBefore.mate ?? null, iAmWhite, fenSideIsWhite(fenBeforeMine));
      const cpAfter = scoreFromMyPov(evAfter.scoreCp ?? 0, evAfter.mate ?? null, iAmWhite, fenSideIsWhite(fenAfterMine));
      const cpLoss = cpBefore - cpAfter;

      if (cpLoss >= SURE_CHECK_CP_LOSS_THRESHOLD && evAfter.bestMoveUci) {
        const sureInfo = detectSureCheck(fenAfterMine, evAfter.bestMoveUci);
        if (sureInfo) {
          setPendingSure({ from, to, phrase: sureInfo.phrase, threatSquare: sureInfo.threatSquare });
          return false;
        }
      }
      commitMyMove(from, to);
      return true;
    } finally {
      setEvaluatingMove(false);
    }
  }

  function commitMyMove(from: string, to: string) {
    const mv = boardRef.current.move({ from, to, promotion: "q" } as never);
    if (!mv) return;
    setFen(boardRef.current.fen());
    setHistory((h) => [...h, mv.san]);
    setLastMove({ from: mv.from, to: mv.to, by: "me" });
    setCoachInline(null);
    setHint(null);
    if (!checkGameOver()) {
      // Salvo il timeout ref per poterlo cancellare su undo
      engineTimeoutRef.current = setTimeout(() => {
        engineTimeoutRef.current = null;
        engineMove();
      }, 250);
    }
  }

  // Undo multi-step — annulla 2 plies (mia mossa + risposta engine), o 1 se è il turno iniziale
  function handleUndo() {
    if (history.length === 0) return;
    if (engineThinking) return;
    // Cancella il timer engine se non è ancora partito
    if (engineTimeoutRef.current !== null) {
      clearTimeout(engineTimeoutRef.current);
      engineTimeoutRef.current = null;
    }
    const plies = history.length >= 2 ? 2 : 1;
    for (let i = 0; i < plies; i++) {
      boardRef.current.undo();
    }
    setFen(boardRef.current.fen());
    setHistory((h) => h.slice(0, h.length - plies));
    setLastMove(null);
    setOutcome(null);
    setCoachInline(pickRandom(RIPENSACI_PHRASES));
  }

  // Rifai partita intera — reset alla startFen
  function handleRestart() {
    if (engineThinking) return;
    if (engineTimeoutRef.current !== null) {
      clearTimeout(engineTimeoutRef.current);
      engineTimeoutRef.current = null;
    }
    boardRef.current = new Chess(startFen);
    setFen(startFen);
    setHistory([]);
    setLastMove(null);
    setOutcome(null);
    setPendingSure(null);
    const msgs = ["Rifacciamo da capo.", "Così. Da capo, con calma."];
    setCoachInline(msgs[Math.floor(Math.random() * msgs.length)]);
    // Se è il turno dell'engine all'apertura, fai muovere lui
    const sideToMove = turnFromFen(startFen);
    if (sideToMove !== myColor) {
      setTimeout(() => engineMove(), 350);
    }
  }

  function sureCheckCancel() {
    setPendingSure(null);
    setCoachInline(pickRandom(RIPROVO_AFTER_SURE_PHRASES));
  }

  function sureCheckConfirm() {
    if (!pendingSure) return;
    const { from, to } = pendingSure;
    setPendingSure(null);
    commitMyMove(from, to);
  }

  function commit(outcomeFinal: PlayResult["outcome"]) {
    onDone({
      outcome: outcomeFinal,
      moves_played: history.length,
      finished_at: Date.now(),
    });
  }

  const lastMoveColor = lastMove?.by === "me" ? "#a18bff" : "#fde047";
  const baseHighlights = lastMove
    ? [
        { square: lastMove.from, color: `${lastMoveColor}55` },
        { square: lastMove.to, color: `${lastMoveColor}aa` },
      ]
    : [];
  const sureHighlights = pendingSure
    ? [
        { square: pendingSure.from, color: "#a18bff66" },
        { square: pendingSure.to, color: "#a18bffaa" },
        { square: pendingSure.threatSquare, color: "#f43f5eaa" },
      ]
    : [];

  // Hint highlights/arrows (Tier 2: highlight from-square; Tier 3: arrow)
  const hintHighlights: { square: string; color: string }[] =
    hint && hint.hintSquare && !pendingSure
      ? [{ square: hint.hintSquare, color: "#f6c64acc" }]
      : [];
  const hintArrows: { from: string; to: string; color: string }[] =
    hint && hint.hintArrow && !pendingSure
      ? [{ from: hint.hintArrow.from, to: hint.hintArrow.to, color: "#34d399" }]
      : [];

  const highlights = pendingSure
    ? sureHighlights
    : [...baseHighlights, ...hintHighlights];
  const arrows = pendingSure
    ? []
    : [
        ...(lastMove ? [{ from: lastMove.from, to: lastMove.to, color: lastMoveColor }] : []),
        ...hintArrows,
      ];

  const openPlayLine = coachSession?.open_play || sessionFallbackLine("open_play", maiaLevel ?? 1600);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">
      {/* BoardScene entrance: sceneKey = startFen (the game position).
          Does NOT re-trigger on every move — only on the initial position entry.
          fit.ref stays on the inner div (callback ref, b10ee1a fix).
          pointerEvents are blocked during the rise by BoardScene, so the
          draggable board cannot be touched while rotated. The engine may start
          thinking at mount (if sideToMove !== myColor) — that is fine since the
          engine move has its own natural delay and plays after the board is up. */}
      <div className="flex flex-col items-center gap-2">
        <BoardScene sceneKey={startFen}>
          <div ref={fit.ref} style={{ width: "100%", maxWidth: fit.max }}>
            <BoardView
              fen={fen}
              resetKey={startFen}
              orientation={myColor}
              size={fit.size}
              draggable={!outcome && !engineThinking && !evaluatingMove && !pendingSure && turnFromFen(fen) === myColor}
              onPieceDrop={onDrop}
              highlights={highlights}
              arrows={arrows}
            />
          </div>
        </BoardScene>
        <BoardLegend preset="play" />
      </div>

      <div className="space-y-4">
        {/* Voce di Nonno: inline messages take priority (e.g. restart), else the
            opening line stays until the first move is played */}
        {coachInline ? (
          <CoachNote text={coachInline} tone="warm" />
        ) : (
          history.length === 0 && !outcome && <CoachNote text={openPlayLine} tone="warm" />
        )}

        {/* Hint di Nonno — appare dopo 12s idle o su richiesta */}
        {!outcome && !coachInline && (
          <NonnoHint
            hint={hint}
            isMyTurn={isMyTurn}
            fen={fen}
            onAsk={() => {
              hintFenRef.current = fen;
              computeHint(fen, 1);
            }}
            onEscalate={() => {
              if (!hint) return;
              const nextTier = Math.min(3, hint.tier + 1) as 1 | 2 | 3;
              computeHint(fen, nextTier);
            }}
          />
        )}

        {/* Intestazione partita */}
        <div>
          <div
            className="label-eyebrow"
            style={{ color: "var(--color-brand-soft)", marginBottom: "0.5rem" }}
          >
            {maiaLevel != null
              ? `Una posizione tua, contro un ${maiaLevel}`
              : `Partita dalla tua posizione`}
          </div>
          <h3
            className="display-small"
            style={{ marginBottom: "0.375rem" }}
          >
            {outcome
              ? outcomeLabel(outcome)
              : evaluatingMove
              ? "Vediamo la mossa…"
              : turnFromFen(fen) === myColor
              ? "Tocca a te"
              : engineThinking
              ? "L'avversario pensa…"
              : "Attendi mossa avversario"}
          </h3>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--color-text-soft)",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {maiaLevel != null
              ? `${maiaSubText(currentRating, maiaLevel)}`
              : `Giochi come ${myColor === "white" ? "bianco" : "nero"} da una tua posizione critica.`}
          </p>
        </div>

        {/* Lista mosse */}
        {!outcome && (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              border: "1px solid var(--color-line)",
              background: "rgba(255,255,255,0.018)",
            }}
          >
            <div
              className="label-eyebrow"
              style={{ marginBottom: "0.5rem" }}
            >
              Mosse
            </div>
            <div
              className="mono"
              style={{
                fontSize: "0.8125rem",
                lineHeight: 1.7,
                color: "var(--color-text-soft)",
              }}
            >
              {history.length === 0 ? (
                <span style={{ opacity: 0.4, color: "var(--color-muted)" }}>attendo la tua mossa</span>
              ) : (
                history.map((m, i) => (
                  <span key={i}>
                    {i % 2 === 0 && (
                      <span style={{ color: "var(--color-faint)", marginRight: "0.2rem" }}>
                        {Math.floor(i / 2) + 1}.{" "}
                      </span>
                    )}
                    <span
                      style={{
                        color: i % 2 === 0
                          ? (i === history.length - 1 ? "var(--color-brand-soft)" : "var(--color-text-soft)")
                          : (i === history.length - 1 ? "var(--color-gold-soft)" : "var(--color-text-soft)"),
                        fontWeight: i === history.length - 1 ? 700 : 400,
                      }}
                    >
                      {m}
                    </span>{" "}
                  </span>
                ))
              )}
            </div>
          </div>
        )}

        {/* Azioni partita in corso */}
        {!outcome && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              onClick={handleUndo}
              disabled={history.length === 0 || engineThinking}
              className="btn btn-ghost btn-sm"
              title="Annulla ultima mossa"
            >
              Indietro
            </button>
            <button
              onClick={handleRestart}
              disabled={engineThinking}
              className="btn btn-ghost btn-sm"
              title="Ricomincia dalla posizione iniziale"
            >
              Ricomincia
            </button>
            <button
              onClick={() => commit("abandoned")}
              className="btn btn-ghost btn-sm"
            >
              Termina
            </button>
          </div>
        )}

        {/* Esito partita */}
        {outcome && (
          <div
            className="position-puzzle-verdict"
            style={{
              borderRadius: "12px",
              padding: "1.25rem",
              border: `1px solid ${outcomeBorder(outcome)}44`,
              background: outcomeBg(outcome),
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "1.3rem",
                lineHeight: 1.25,
                color: outcomeBorder(outcome),
                marginBottom: "0.5rem",
              }}
            >
              {outcomeLabel(outcome)}
            </div>
            <div
              className="mono"
              style={{
                fontSize: "0.75rem",
                color: "var(--color-muted)",
                marginBottom: "1.25rem",
              }}
            >
              {history.length} mosse giocate
            </div>
            <button
              onClick={() => commit(outcome)}
              className="btn btn-primary btn-lg"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Vai avanti
            </button>
          </div>
        )}
      </div>

      {pendingSure && (
        <SureCheck
          phrase={pendingSure.phrase}
          onCancel={sureCheckCancel}
          onConfirm={sureCheckConfirm}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NonnoHint — UI component per il sistema di indizi in partita
// ---------------------------------------------------------------------------

interface NonnoHintProps {
  hint: HintState | null;
  isMyTurn: boolean;
  fen: string;
  onAsk: () => void;
  onEscalate: () => void;
}

function NonnoHint({ hint, isMyTurn, onAsk, onEscalate }: NonnoHintProps) {
  if (!isMyTurn) return null;

  // No hint yet: show the pulsing "Chiedi a Nonno" affordance
  if (!hint) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <button
          onClick={onAsk}
          className="btn btn-ghost btn-sm"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            color: "var(--color-muted)",
            borderColor: "var(--color-line)",
            fontSize: "0.75rem",
          }}
          title="Chiedi un consiglio a Nonno"
        >
          <span style={{
            width: "6px",
            height: "6px",
            borderRadius: "999px",
            background: "var(--color-brand-soft)",
            flexShrink: 0,
            animation: "pulseGlow 2s ease-in-out infinite",
          }} />
          Chiedi a Nonno
        </button>
      </div>
    );
  }

  return (
    <div style={{
      padding: "0.75rem 1rem",
      borderRadius: "8px",
      border: "1px solid rgba(161,139,255,0.22)",
      background: "rgba(161,139,255,0.05)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        marginBottom: "0.5rem",
      }}>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.6rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-brand-soft)",
          fontWeight: 700,
        }}>
          Nonno
        </span>
        {hint.loading && (
          <span style={{
            width: "5px",
            height: "5px",
            borderRadius: "999px",
            background: "var(--color-brand-soft)",
            animation: "pulseGlow 1.2s ease-in-out infinite",
          }} />
        )}
        {!hint.loading && (
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.6rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-faint)",
          }}>
            {hint.tier === 1 ? "primo sguardo" : hint.tier === 2 ? "casa di partenza" : "mossa completa"}
          </span>
        )}
      </div>

      {/* Text */}
      {!hint.loading && (
        <p style={{
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          lineHeight: 1.55,
          color: "var(--color-text-soft)",
          margin: 0,
          marginBottom: hint.tier < 3 ? "0.625rem" : 0,
        }}>
          {hint.text}
        </p>
      )}

      {hint.loading && (
        <p style={{
          fontFamily: "var(--font-sans)",
          fontSize: "0.8rem",
          color: "var(--color-muted)",
          margin: 0,
          marginBottom: "0.5rem",
        }}>
          Guardo la posizione…
        </p>
      )}

      {/* Escalate button — show only when not at tier 3 and not loading */}
      {!hint.loading && hint.tier < 3 && (
        <button
          onClick={onEscalate}
          className="btn btn-ghost btn-sm"
          style={{
            fontSize: "0.7rem",
            color: "var(--color-muted)",
            borderColor: "var(--color-line)",
            padding: "0.25rem 0.625rem",
          }}
        >
          Un altro indizio
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SureCheck detection
// ---------------------------------------------------------------------------

const PIECE_NAMES_IT: Record<string, string> = {
  p: "pedone",
  n: "cavallo",
  b: "alfiere",
  r: "torre",
  q: "donna",
  k: "re",
};

const SURE_PHRASES = [
  (piece: string, sq: string) => `Oooh... sei sicuro? Il ${piece} in ${sq} resta non protetto. Lo prendo.`,
  (piece: string, sq: string) => `Aspetta. Conta i difensori del ${piece} in ${sq}. Io ho un attaccante in più.`,
  (piece: string, sq: string) => `Mh. Hai mosso, e il ${piece} in ${sq} è rimasto indifeso. Sei sicuro?`,
  (piece: string, sq: string) => `Hai fretta? Il ${piece} in ${sq} non ha difensori. Te lo prendo.`,
];

function detectSureCheck(fenAfterMine: string, bestOppUci: string): { threatSquare: string; phrase: string } | null {
  if (!bestOppUci || bestOppUci.length < 4) return null;
  const from = bestOppUci.slice(0, 2);
  const to = bestOppUci.slice(2, 4);
  const promo = bestOppUci.length > 4 ? bestOppUci[4] : undefined;
  try {
    const b = new Chess(fenAfterMine);
    const mv = b.move({ from, to, promotion: promo || "q" } as never);
    if (!mv || !mv.captured) return null;
    const pieceName = PIECE_NAMES_IT[mv.captured] || "pezzo";
    const phraseFn = SURE_PHRASES[Math.floor(Math.random() * SURE_PHRASES.length)];
    return { threatSquare: to, phrase: phraseFn(pieceName, to) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Eval normalization (POV mine)
// ---------------------------------------------------------------------------

function fenSideIsWhite(fen: string): boolean {
  return fen.split(" ")[1] !== "b";
}

function scoreFromMyPov(scoreCp: number | null, mate: number | null, iAmWhite: boolean, sideToMoveIsWhite: boolean): number {
  const cp = mate != null ? (mate > 0 ? 10000 : -10000) : (scoreCp ?? 0);
  if (sideToMoveIsWhite === iAmWhite) return cp;
  return -cp;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function outcomeLabel(o: PlayResult["outcome"]): string {
  return { win: "Hai vinto!", draw: "Patta", loss: "Hai perso", abandoned: "Partita interrotta." }[o];
}
function outcomeBorder(o: PlayResult["outcome"]): string {
  return { win: "#34d399", draw: "#94a3b8", loss: "#f43f5e", abandoned: "#94a3b8" }[o];
}
function outcomeBg(o: PlayResult["outcome"]): string {
  return {
    win: "rgba(52,211,153,0.06)",
    draw: "rgba(148,163,184,0.06)",
    loss: "rgba(244,63,94,0.06)",
    abandoned: "rgba(148,163,184,0.06)",
  }[o];
}
