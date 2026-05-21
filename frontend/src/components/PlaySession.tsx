import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { BoardView } from "./BoardView";
import { useStockfish } from "../engine/useStockfish";

/**
 * "Continue from here" — modalità partita.
 *
 * Parte da un FEN (turning point o drill), tu giochi, Stockfish risponde.
 * Skill level dell'engine configurabile (0=debole, 20=max). Default 8 ≈ 1600 ELO.
 * Tracciamo la lista di mosse + la valutazione ad ogni step.
 *
 * Senza backend: tutta la logica in browser.
 */

interface Props {
  startFen: string;
  startSan?: string;       // mossa originale (per "compara col reale")
  myColor: "white" | "black";
  context?: { date?: string; opp_rating?: number | null; opening?: string | null; eco?: string | null };
  onClose?: () => void;
}

const SKILL_LEVELS: { label: string; skill: number; elo: string }[] = [
  { label: "principiante", skill: 1, elo: "~800" },
  { label: "club basso", skill: 4, elo: "~1200" },
  { label: "il tuo target", skill: 8, elo: "~1600" },
  { label: "forte", skill: 14, elo: "~2000" },
  { label: "max", skill: 20, elo: "~2400" },
];

interface MoveRecord {
  ply: number;
  san: string;
  byMe: boolean;
  cpAfter: number | null;     // dal POV mio
}

export function PlaySession({ startFen, startSan, myColor, context, onClose }: Props) {
  const sf = useStockfish();
  const gameRef = useRef<Chess>(new Chess(startFen));
  const [fen, setFen] = useState(startFen);
  const [skill, setSkill] = useState(8);
  const [history, setHistory] = useState<MoveRecord[]>([]);
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<"playing" | "ended">("playing");
  const [result, setResult] = useState<string | null>(null);
  const [evalCp, setEvalCp] = useState<number | null>(null);

  const sideToMove = useMemo(() => (fen.split(" ")[1] === "b" ? "black" : "white"), [fen]);
  const myTurn = sideToMove === myColor;

  // Quando tocca all'engine, fai giocare Stockfish
  useEffect(() => {
    if (status !== "playing") return;
    if (myTurn) return;
    let cancelled = false;
    (async () => {
      setThinking(true);
      try {
        const ev = await sf.evaluate(fen, { skillLevel: skill, depth: 12 });
        if (cancelled) return;
        const uci = ev.bestMoveUci;
        if (!uci) return;
        const move = gameRef.current.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        } as never);
        if (move) {
          const newFen = gameRef.current.fen();
          setFen(newFen);
          setHistory((h) => [
            ...h,
            { ply: h.length + 1, san: move.san, byMe: false, cpAfter: ev.scoreCp ?? null },
          ]);
          checkGameEnd();
        }
      } finally {
        setThinking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, myTurn, status, skill]);

  // Eval di sfondo continua per la barra
  useEffect(() => {
    if (status !== "playing") return;
    let cancelled = false;
    sf.evaluate(fen, { depth: 12 }).then((ev) => {
      if (cancelled) return;
      let cp = ev.scoreCp ?? 0;
      // riporta al POV del bianco
      if (sideToMove === "black") cp = -cp;
      // poi al POV mio
      if (myColor === "black") cp = -cp;
      setEvalCp(cp);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, status]);

  function checkGameEnd(): void {
    const g = gameRef.current;
    if (g.isGameOver()) {
      setStatus("ended");
      if (g.isCheckmate()) {
        const loserIsMe = g.turn() === (myColor === "white" ? "w" : "b");
        setResult(loserIsMe ? "Matto. Hai perso." : "Matto. Hai vinto!");
      } else if (g.isStalemate()) setResult("Stallo · patta");
      else if (g.isDraw()) setResult("Patta");
      else setResult("Fine partita");
    }
  }

  function onDrop(from: string, to: string): boolean {
    if (status !== "playing" || !myTurn || thinking) return false;
    const move = gameRef.current.move({ from, to, promotion: "q" } as never);
    if (!move) return false;
    const newFen = gameRef.current.fen();
    setFen(newFen);
    setHistory((h) => [...h, { ply: h.length + 1, san: move.san, byMe: true, cpAfter: null }]);
    checkGameEnd();
    return true;
  }

  function reset() {
    gameRef.current = new Chess(startFen);
    setFen(startFen);
    setHistory([]);
    setStatus("playing");
    setResult(null);
  }

  const evalBar = useMemo(() => {
    if (evalCp == null) return 50;
    // Mappa [-500, +500] → [0, 100]
    const pct = 50 + Math.max(-50, Math.min(50, (evalCp / 1000) * 50));
    return Math.round(pct);
  }, [evalCp]);

  return (
    <div className="surface surface-padded">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-5">
        <div>
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Continue from here</div>
          <p className="text-sm text-[color:var(--color-text-soft)] mt-2 max-w-xl">
            Riprendi questa posizione contro Stockfish con la forza che scegli. Vedi come sarebbe potuta andare.
            {startSan && (
              <> In partita reale avevi giocato <span className="font-mono text-rose-300">{startSan}</span>.</>
            )}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn btn-ghost text-xs">Chiudi ×</button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[auto_16px_1fr] gap-6 items-start">
        <div className="flex justify-center">
          <BoardView
            fen={fen}
            orientation={myColor}
            size={440}
            draggable={status === "playing" && myTurn && !thinking}
            onPieceDrop={onDrop}
          />
        </div>

        {/* Eval bar verticale */}
        <div className="h-[440px] w-3 rounded-full bg-rose-900/40 overflow-hidden relative hidden lg:block">
          <div
            className="absolute left-0 right-0 top-0 bg-gradient-to-b from-white/90 to-white/70 transition-all duration-300"
            style={{ height: `${evalBar}%` }}
          />
        </div>

        <div className="space-y-4">
          {/* Skill picker */}
          <div>
            <div className="label-eyebrow">Forza avversario</div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SKILL_LEVELS.map((s) => (
                <button
                  key={s.skill}
                  onClick={() => setSkill(s.skill)}
                  className={
                    "px-2.5 py-1 rounded-md text-xs transition " +
                    (skill === s.skill
                      ? "bg-[color:var(--color-brand)] text-white"
                      : "border border-[color:var(--color-line)] text-[color:var(--color-text-soft)] hover:bg-white/5")
                  }
                >
                  <span className="font-semibold">{s.elo}</span> · {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Contesto */}
          {context && (
            <div className="text-sm">
              <div className="label-eyebrow">Contesto originale</div>
              <div className="mt-2 text-[color:var(--color-text)]">
                {context.date && <span>{context.date}</span>}
                {context.opp_rating != null && <span> · vs <b>{context.opp_rating}</b></span>}
              </div>
              {context.opening && (
                <div className="text-[color:var(--color-text-soft)] text-xs">
                  {context.opening} <span className="font-mono opacity-70">({context.eco})</span>
                </div>
              )}
            </div>
          )}

          {/* Stato */}
          {!sf.isReady && <div className="pill pill-warn">Carico Stockfish…</div>}
          {thinking && <div className="pill pill-brand">Stockfish pensa…</div>}
          {status === "ended" && (
            <div className="rounded-xl p-4 border border-[color:var(--color-brand)]/40 bg-[color:var(--color-brand)]/5">
              <div className="font-[var(--font-display)] text-lg font-semibold">{result}</div>
              <button onClick={reset} className="btn btn-ghost text-xs mt-3">↻ Rigioca dall'inizio</button>
            </div>
          )}

          {/* Move list */}
          <div>
            <div className="label-eyebrow">Mosse giocate ({history.length})</div>
            <div className="grid grid-cols-2 gap-x-3 mt-2 max-h-[180px] overflow-auto pr-2">
              {history.map((m, i) => (
                <div key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="font-mono text-xs text-[color:var(--color-muted)] w-7 text-right tabular-nums">
                    {Math.floor(i / 2) + 1}.{i % 2 === 1 ? ".." : ""}
                  </span>
                  <span className={m.byMe ? "text-[color:var(--color-text)] font-medium" : "text-[color:var(--color-text-soft)]"}>
                    {m.san}
                  </span>
                </div>
              ))}
              {history.length === 0 && (
                <div className="text-xs text-[color:var(--color-muted)] italic">Nessuna mossa ancora.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
