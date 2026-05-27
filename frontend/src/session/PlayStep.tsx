import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { BoardView } from "../components/BoardView";
import { BoardLegend } from "../components/BoardLegend";
import { CoachNote } from "../components/CoachNote";
import { SureCheck } from "../components/SureCheck";
import { useStockfish } from "../engine/useStockfish";
import { turnFromFen } from "../chess-utils";
import type { PlayResult } from "./store";
import type { CoachSession } from "../types";
import { stockfishSkillForMaiaLevel, maiaLabel, sessionFallbackLine, timeClassLabel } from "../coaching";

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
  if (cur < maiaLevel - 50) return "Il giocatore che vuoi diventare. Vediamo dove ti porta.";
  if (cur >= maiaLevel) return "Stesso livello. Niente sconti.";
  return "Vicino al target. Oggi serve precisione.";
}

// ---------------------------------------------------------------------------
// EvalBar — barra verticale vantaggio Stockfish (POV bianco, normalizzata tanh)
// ---------------------------------------------------------------------------
function EvalBar({ score, mate }: { score: number | null; mate: number | null }) {
  const H = 500;
  const W = 14;
  let pct = 0.5;
  let label = "0.0";
  if (mate != null) {
    pct = mate > 0 ? 1 : 0;
    label = `M${Math.abs(mate)}`;
  } else if (score != null) {
    pct = 0.5 + 0.5 * Math.tanh(score / 400);
    const pawns = score / 100;
    label = (pawns >= 0 ? "+" : "") + pawns.toFixed(1);
  }
  const whiteH = Math.round(H * pct);
  const blackH = H - whiteH;
  return (
    <div className="eval-bar" style={{ height: H, width: W }}>
      <div className="eval-bar-black" style={{ height: blackH }} />
      <div className="eval-bar-white" style={{ height: whiteH }} />
      <div className="eval-bar-label">{label}</div>
    </div>
  );
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
  timeClass,
  coachSession,
  onDone,
}: Props) {
  const tcLabel = timeClassLabel(timeClass);
  // Deriva skillLevel da maiaLevel se disponibile, altrimenti prop legacy
  const skillLevel = maiaLevel != null
    ? stockfishSkillForMaiaLevel(maiaLevel)
    : (skillLevelProp ?? 8);
  const sf = useStockfish();
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

  // EvalBar state — score dal POV BIANCO
  const [evalScore, setEvalScore] = useState<number | null>(null);
  const [evalMate, setEvalMate] = useState<number | null>(null);

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

  // Aggiorna eval dopo ogni cambio di fen
  useEffect(() => {
    let cancelled = false;
    async function evalNow() {
      try {
        const ev = await sf.evaluate(fen, { depth: 12 });
        if (cancelled) return;
        const fenTurn = turnFromFen(fen);
        const cpWhitePov =
          ev.mate != null
            ? null
            : ev.scoreCp != null
            ? fenTurn === "white"
              ? ev.scoreCp
              : -ev.scoreCp
            : null;
        const mateWhitePov =
          ev.mate != null
            ? fenTurn === "white"
              ? ev.mate
              : -ev.mate
            : null;
        setEvalScore(cpWhitePov);
        setEvalMate(mateWhitePov);
      } catch {
        /* ignore */
      }
    }
    evalNow();
    return () => {
      cancelled = true;
    };
  }, [fen]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setEvalScore(null);
    setEvalMate(null);
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
  const highlights = pendingSure ? sureHighlights : baseHighlights;
  const arrows = lastMove && !pendingSure ? [{ from: lastMove.from, to: lastMove.to, color: lastMoveColor }] : [];

  const openPlayLine = coachSession?.open_play || sessionFallbackLine("open_play", maiaLevel ?? 1600);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">
      <div className="flex flex-col items-center gap-2">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <EvalBar score={evalScore} mate={evalMate} />
          <BoardView
            fen={fen}
            resetKey={startFen}
            orientation={myColor}
            size={500}
            draggable={!outcome && !engineThinking && !evaluatingMove && !pendingSure && turnFromFen(fen) === myColor}
            onPieceDrop={onDrop}
            highlights={highlights}
            arrows={arrows}
          />
        </div>
        <BoardLegend preset="play" />
      </div>

      <div className="space-y-5">
        {coachInline && (
          <CoachNote text={coachInline} tone="warm" />
        )}

        {!coachInline && history.length === 0 && !outcome && (
          <CoachNote text={openPlayLine} tone="warm" />
        )}

        <div>
          <div className="label-eyebrow">
            Partita finale ·{" "}
            {maiaLevel != null ? `Target: ${maiaLevel} ${tcLabel}` : `livello Stockfish ${skillLevel}/20`}
          </div>
          <h3 className="display-small mt-2">
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
          <div className="text-sm text-[color:var(--color-text-soft)] mt-1">
            {maiaLevel != null
              ? `Giochi contro un ${maiaLabel(maiaLevel)} ${tcLabel} — il livello che hai dichiarato come obiettivo. ${maiaSubText(currentRating, maiaLevel)}`
              : `Posizione presa da un tuo bivio. Giochi come ${myColor === "white" ? "bianco" : "nero"} contro un avversario calibrato.`}
          </div>
        </div>

        {!outcome && (
          <div className="rounded-xl p-3 border border-[color:var(--color-line)] bg-white/[0.02]">
            <div className="label-eyebrow mb-2">Mosse</div>
            <div className="font-mono text-xs leading-relaxed text-[color:var(--color-text-soft)]">
              {history.length === 0 ? <span className="opacity-50">—</span> :
                history.map((m, i) => (
                  <span key={i}>
                    {i % 2 === 0 && <span className="text-[color:var(--color-muted)]">{Math.floor(i / 2) + 1}. </span>}
                    {m}{" "}
                  </span>
                ))
              }
            </div>
          </div>
        )}

        {!outcome && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleUndo}
              disabled={history.length === 0 || engineThinking}
              className="btn btn-ghost btn-sm"
              title="Annulla ultima mossa (2 plies)"
            >
              ← Indietro
            </button>
            <button
              onClick={handleRestart}
              disabled={engineThinking}
              className="btn btn-ghost btn-sm"
              title="Ricomincia dalla posizione iniziale"
            >
              ↻ Rifai partita
            </button>
            <button onClick={() => commit("abandoned")} className="btn btn-ghost btn-sm">
              Termina
            </button>
          </div>
        )}

        {outcome && (
          <div
            className="rounded-xl p-5 border"
            style={{
              borderColor: outcomeBorder(outcome),
              background: outcomeBg(outcome),
            }}
          >
            <div className="display-small" style={{ color: outcomeBorder(outcome) }}>
              {outcomeLabel(outcome)}
            </div>
            <div className="text-sm text-[color:var(--color-text-soft)] mt-1">
              {history.length} mosse giocate.
            </div>
            <button onClick={() => commit(outcome)} className="btn btn-primary mt-4 w-full justify-center">
              Vai al recap →
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
  return { win: "Hai vinto!", draw: "Patta", loss: "Hai perso", abandoned: "Sessione terminata" }[o];
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
