import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { BoardView } from "./BoardView";
import { useStockfish } from "../engine/useStockfish";
import { CoachNote } from "./CoachNote";
import { maiaLabel, sessionFallbackLine, stockfishSkillForMaiaLevel } from "../coaching";

interface Props {
  startFen: string;
  startSan?: string;
  myColor: "white" | "black";
  maiaLevel?: number;
  context?: { date?: string; opp_rating?: number | null; opening?: string | null; eco?: string | null };
  onClose?: () => void;
}

interface MoveRecord {
  ply: number;
  san: string;
  byMe: boolean;
  cpAfter: number | null;
}

export function PlaySession({ startFen, startSan, myColor, maiaLevel = 1600, context, onClose }: Props) {
  const sf = useStockfish();
  const gameRef = useRef<Chess>(new Chess(startFen));
  const [fen, setFen] = useState(startFen);
  const [history, setHistory] = useState<MoveRecord[]>([]);
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<"playing" | "ended">("playing");
  const [result, setResult] = useState<string | null>(null);
  const [evalCp, setEvalCp] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string; by: "me" | "engine" } | null>(null);

  const sideToMove = useMemo(() => (fen.split(" ")[1] === "b" ? "black" : "white"), [fen]);
  const myTurn = sideToMove === myColor;
  const skill = stockfishSkillForMaiaLevel(maiaLevel);
  const opponent = maiaLabel(maiaLevel);

  useEffect(() => {
    if (status !== "playing" || myTurn) return;
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
          setLastMove({ from: move.from, to: move.to, by: "engine" });
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

  useEffect(() => {
    if (status !== "playing") return;
    let cancelled = false;
    sf.evaluate(fen, { depth: 12 }).then((ev) => {
      if (cancelled) return;
      let cp = ev.scoreCp ?? 0;
      if (sideToMove === "black") cp = -cp;
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
    if (!g.isGameOver()) return;
    setStatus("ended");
    if (g.isCheckmate()) {
      const loserIsMe = g.turn() === (myColor === "white" ? "w" : "b");
      setResult(loserIsMe ? "Matto. Hai perso." : "Matto. Hai vinto.");
    } else if (g.isStalemate()) setResult("Stallo. Patta.");
    else if (g.isDraw()) setResult("Patta.");
    else setResult("Fine partita.");
  }

  function onDrop(from: string, to: string): boolean {
    if (status !== "playing" || !myTurn || thinking) return false;
    const move = gameRef.current.move({ from, to, promotion: "q" } as never);
    if (!move) return false;
    setFen(gameRef.current.fen());
    setHistory((h) => [...h, { ply: h.length + 1, san: move.san, byMe: true, cpAfter: null }]);
    setLastMove({ from: move.from, to: move.to, by: "me" });
    checkGameEnd();
    return true;
  }

  function reset() {
    gameRef.current = new Chess(startFen);
    setFen(startFen);
    setHistory([]);
    setStatus("playing");
    setResult(null);
    setLastMove(null);
  }

  const evalBar = useMemo(() => {
    if (evalCp == null) return 50;
    const pct = 50 + Math.max(-50, Math.min(50, (evalCp / 1000) * 50));
    return Math.round(pct);
  }, [evalCp]);

  return (
    <div className="surface surface-padded">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-5">
        <div>
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Rigioca il bivio</div>
          <p className="text-sm text-[color:var(--color-text-soft)] mt-2 max-w-xl">
            Riprendi questa posizione contro {opponent}. Non e' una review: e' la stessa posizione, giocata al tavolo.
            {startSan && (
              <> In partita reale avevi giocato <span className="font-mono text-rose-300">{startSan}</span>.</>
            )}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn btn-ghost text-xs">Chiudi x</button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[auto_16px_1fr] gap-6 items-start">
        <div className="flex flex-col items-center gap-2">
          <TurnBanner status={status} myTurn={myTurn} thinking={thinking} maiaLevel={maiaLevel} />
          <BoardView
            fen={fen}
            resetKey={startFen}
            orientation={myColor}
            size={440}
            draggable={status === "playing" && myTurn && !thinking}
            onPieceDrop={onDrop}
            highlights={lastMove ? buildLastMoveHighlights(lastMove) : []}
            arrows={lastMove ? buildLastMoveArrows(lastMove) : []}
          />
          {lastMove && (
            <div className="text-[10px] font-mono text-[color:var(--color-muted)] tracking-wide uppercase">
              Ultima mossa  -  <span style={{ color: lastMove.by === "me" ? "#a18bff" : "#fde047" }}>
                {lastMove.by === "me" ? "tua" : opponent}
              </span>  -  {lastMove.from} -&gt; {lastMove.to}
            </div>
          )}
        </div>

        <div className="h-[440px] w-3 rounded-full bg-rose-900/40 overflow-hidden relative hidden lg:block">
          <div
            className="absolute left-0 right-0 top-0 bg-gradient-to-b from-white/90 to-white/70 transition-all duration-300"
            style={{ height: `${evalBar}%` }}
          />
        </div>

        <div className="space-y-4">
          <CoachNote text={sessionFallbackLine("open_play", maiaLevel)} tone="warm" />

          {context && (
            <div className="text-sm">
              <div className="label-eyebrow">Contesto originale</div>
              <div className="mt-2 text-[color:var(--color-text)]">
                {context.date && <span>{context.date}</span>}
                {context.opp_rating != null && <span>  -  vs <b>{context.opp_rating}</b></span>}
              </div>
              {context.opening && (
                <div className="text-[color:var(--color-text-soft)] text-xs">
                  {context.opening} <span className="font-mono opacity-70">({context.eco})</span>
                </div>
              )}
            </div>
          )}

          {!sf.isReady && <div className="pill pill-warn">Preparo {opponent}...</div>}
          {thinking && <div className="pill pill-brand">{opponent} pensa...</div>}
          {status === "ended" && (
            <div className="rounded-xl p-4 border border-[color:var(--color-brand)]/40 bg-[color:var(--color-brand)]/5">
              <div className="font-[var(--font-display)] text-lg font-semibold">{result}</div>
              <button onClick={reset} className="btn btn-ghost text-xs mt-3">Rigioca dall'inizio</button>
            </div>
          )}

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

function TurnBanner({
  status,
  myTurn,
  thinking,
  maiaLevel,
}: {
  status: "playing" | "ended";
  myTurn: boolean;
  thinking: boolean;
  maiaLevel: number;
}) {
  if (status === "ended") return null;
  if (thinking) {
    return (
      <div className="pill pill-warn pulse-glow">
        <span className="dot" style={{ background: "#fde047" }} />
        {maiaLabel(maiaLevel)} pensa...
      </div>
    );
  }
  if (myTurn) {
    return (
      <div className="pill pill-brand">
        <span className="dot" style={{ background: "#a18bff" }} />
        Tocca a te
      </div>
    );
  }
  return (
    <div className="pill">
      <span className="dot" style={{ background: "#fde047" }} />
      Attendi mossa {maiaLabel(maiaLevel)}
    </div>
  );
}

function buildLastMoveHighlights(lm: { from: string; to: string; by: "me" | "engine" }) {
  const color = lm.by === "me" ? "#a18bff" : "#fde047";
  return [
    { square: lm.from, color: `${color}55` },
    { square: lm.to, color: `${color}aa` },
  ];
}

function buildLastMoveArrows(lm: { from: string; to: string; by: "me" | "engine" }) {
  const color = lm.by === "me" ? "#a18bff" : "#fde047";
  return [{ from: lm.from, to: lm.to, color }];
}

