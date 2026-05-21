import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { BoardView } from "../components/BoardView";
import { useStockfish } from "../engine/useStockfish";
import { turnFromFen } from "../chess-utils";
import type { PlayResult } from "./store";

interface Props {
  startFen: string;             // posizione di partenza (di solito da un turning point)
  myColor?: "white" | "black";  // override opzionale; di default derivato da startFen (chi muove)
  skillLevel?: number;          // 0-20, default 8 (giocatore amatoriale)
  onDone: (r: PlayResult) => void;
}

/**
 * Una partita vs Stockfish dalla posizione data. Stockfish gioca a skill
 * limitato (default 8) per essere battibile. Termina quando finisce la
 * partita (matto/stalemate/draw) o l'utente clicca "Termina sessione".
 */
export function PlayStep({ startFen, myColor: myColorProp, skillLevel = 8, onDone }: Props) {
  const sf = useStockfish();
  // Invariante: fen_before di un turning point = posizione in cui IO devo muovere.
  // Quindi il side-to-move dello startFen è il mio colore. Derivo da lì, ignoro
  // prop se incoerente (più robusto contro session vecchie in localStorage).
  const myColor: "white" | "black" = myColorProp || turnFromFen(startFen);
  const boardRef = useRef<Chess>(new Chess(startFen));
  const [fen, setFen] = useState<string>(startFen);
  const [history, setHistory] = useState<string[]>([]);     // SAN moves
  const [engineThinking, setEngineThinking] = useState(false);
  const [outcome, setOutcome] = useState<PlayResult["outcome"] | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);

  // Se è il turno dell'engine all'apertura, fai muovere lui
  useEffect(() => {
    const sideToMove = turnFromFen(startFen);
    if (sideToMove !== myColor && !outcome) {
      engineMove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setLastMove({ from: mv.from, to: mv.to });
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
      // chi è "in scacco matto" perde. turn() ritorna il colore che DEVE muovere = quello mattato
      const loser = b.turn() === "w" ? "white" : "black";
      res = loser === myColor ? "loss" : "win";
    } else {
      res = "draw";
    }
    setOutcome(res);
    return true;
  }

  async function onDrop(from: string, to: string): Promise<boolean> {
    if (outcome) return false;
    if (engineThinking) return false;
    const sideToMove = turnFromFen(boardRef.current.fen());
    if (sideToMove !== myColor) return false;
    const mv = boardRef.current.move({ from, to, promotion: "q" } as never);
    if (!mv) return false;
    setFen(boardRef.current.fen());
    setHistory((h) => [...h, mv.san]);
    setLastMove({ from: mv.from, to: mv.to });
    if (!checkGameOver()) {
      // delay simbolico per evitare reazione istantanea
      setTimeout(() => engineMove(), 250);
    }
    return true;
  }

  function commit(outcomeFinal: PlayResult["outcome"]) {
    onDone({
      outcome: outcomeFinal,
      moves_played: history.length,
      finished_at: Date.now(),
    });
  }

  const highlights = lastMove
    ? [
        { square: lastMove.from, color: "#fde04755" },
        { square: lastMove.to, color: "#fde04788" },
      ]
    : [];
  const arrows = lastMove ? [{ from: lastMove.from, to: lastMove.to, color: "#fde047" }] : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">
      <div className="flex justify-center">
        <BoardView
          fen={fen}
          resetKey={startFen}
          orientation={myColor}
          size={500}
          draggable={!outcome && !engineThinking && turnFromFen(fen) === myColor}
          onPieceDrop={onDrop}
          highlights={highlights}
          arrows={arrows}
        />
      </div>

      <div className="space-y-5">
        <div>
          <div className="label-eyebrow">Partita finale · livello Stockfish {skillLevel}/20</div>
          <h3 className="display-small mt-2">
            {outcome
              ? outcomeLabel(outcome)
              : turnFromFen(fen) === myColor
              ? "Tocca a te"
              : engineThinking
              ? "Stockfish pensa…"
              : "Attendi mossa engine"}
          </h3>
          <div className="text-sm text-[color:var(--color-text-soft)] mt-1">
            Posizione presa da un tuo bivio. Giochi come {myColor === "white" ? "bianco" : "nero"} contro
            Stockfish a forza limitata. Vediamo se ora la chiudi.
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
          <div className="flex gap-2">
            <button onClick={() => commit("abandoned")} className="btn btn-ghost btn-sm">
              Termina e vai al recap
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
    </div>
  );
}

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
